package com.yourapp.textextractor

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.os.Handler
import android.os.Looper
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.Arguments

class ShortsExtractorService : AccessibilityService() {
    private var lastScrapedHash = 0
    private val handler = Handler(Looper.getMainLooper())
    private var pendingExtractionRunnable: Runnable? = null

    companion object {
        var reactContext: ReactApplicationContext? = null
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null || reactContext == null) return
        
        // Only trigger on swipe/scroll or initial window opening
        if (event.eventType != AccessibilityEvent.TYPE_VIEW_SCROLLED &&
            event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val packageName = event.packageName?.toString() ?: ""
        val allowedPackages = setOf(
            "com.google.android.youtube",
            "com.zhiliaoapp.musically",
            "com.ss.android.ugc.trill",
            "com.instagram.android",
            "com.facebook.katana",
            "com.facebook.lite"
        )
        if (!allowedPackages.contains(packageName)) return

        // Debounce: Cancel previous scheduled extraction
        pendingExtractionRunnable?.let { handler.removeCallbacks(it) }

        // Schedule extraction with 400ms delay to let layout settle
        val runnable = Runnable {
            performExtraction(packageName)
        }
        pendingExtractionRunnable = runnable
        handler.postDelayed(runnable, 400L)
    }

    private fun performExtraction(packageName: String) {
        val rootNode = rootInActiveWindow ?: return
        
        val displayRect = android.graphics.Rect()
        rootNode.getBoundsInScreen(displayRect)
        val screenWidth = displayRect.width()
        val screenHeight = displayRect.height()

        val nodes = mutableListOf<NodeData>()
        collectNodes(rootNode, nodes, screenWidth, screenHeight)
        rootNode.recycle()

        if (nodes.isEmpty()) return

        // Deduplicate: Compare layout hashes
        val contentHash = nodes.map { it.text }.hashCode()
        if (contentHash == lastScrapedHash) return
        lastScrapedHash = contentHash

        val currentTime = System.currentTimeMillis()

        var creator = ""
        val captions = mutableListOf<String>()
        val comments = mutableListOf<String>()
        val hashtags = mutableListOf<String>()

        for (node in nodes) {
            val text = node.text
            val viewId = node.viewId

            // Parse hashtags from text
            val tags = text.split(Regex("\\s+")).filter { it.startsWith("#") }
            hashtags.addAll(tags)

            // Strip hashtags from text for cleaner caption formatting
            val cleanText = text.split(Regex("\\s+"))
                .filter { !it.startsWith("#") }
                .joinToString(" ")
                .trim()

            if (cleanText.isEmpty()) continue

            val isCreatorId = viewId.contains("channel", ignoreCase = true) || 
                              viewId.contains("username", ignoreCase = true) || 
                              viewId.contains("handle", ignoreCase = true) ||
                              viewId.contains("profile_name", ignoreCase = true) ||
                              viewId.contains("author", ignoreCase = true)

            if (text.startsWith("@") || isCreatorId) {
                if (creator.isEmpty()) {
                    creator = cleanText
                }
            } else if (viewId.contains("comment", ignoreCase = true) || 
                       viewId.contains("reply", ignoreCase = true)) {
                comments.add(cleanText)
            } else {
                captions.add(cleanText)
            }
        }

        val finalCreator = creator.trim()
        val finalCaption = captions.filter { it.isNotBlank() && it != finalCreator }.distinct().joinToString("\n")
        val finalComments = comments.filter { it.isNotBlank() }.distinct()
        val finalHashtags = hashtags.map { it.replace(Regex("[^#a-zA-Z0-9_]"), "") }.filter { it.length > 1 }.distinct()

        // Build structured WritableMap for RN
        val eventData = Arguments.createMap().apply {
            putString("creator", finalCreator)
            putString("caption", finalCaption)
            putString("packageName", packageName)
            putDouble("timestamp", currentTime.toDouble())
            
            val hashtagsArray = Arguments.createArray()
            finalHashtags.forEach { hashtagsArray.pushString(it) }
            putArray("hashtags", hashtagsArray)

            val commentsArray = Arguments.createArray()
            finalComments.forEach { commentsArray.pushString(it) }
            putArray("comments", commentsArray)

            // Fallback raw text summary for standard display
            val rawSummary = buildString {
                if (finalCreator.isNotEmpty()) append("👤 Creator: $finalCreator\n\n")
                if (finalCaption.isNotEmpty()) append("📝 Caption:\n$finalCaption\n\n")
                if (finalHashtags.isNotEmpty()) append("🏷️ Tags: ${finalHashtags.joinToString(" ")}\n\n")
                if (finalComments.isNotEmpty()) {
                    append("💬 Comments:\n")
                    finalComments.take(3).forEach { append("- $it\n") }
                }
            }
            putString("text", rawSummary.trim())
        }

        reactContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit("onTextExtracted", eventData)
    }

    private fun collectNodes(node: AccessibilityNodeInfo?, nodes: MutableList<NodeData>, screenWidth: Int, screenHeight: Int) {
        if (node == null) return
        
        val text = node.text?.toString()?.trim()
        val contentDesc = node.contentDescription?.toString()?.trim()
        val viewId = node.viewIdResourceName?.toString() ?: ""

        val displayText = if (!text.isNullOrEmpty()) text else if (!contentDesc.isNullOrEmpty()) contentDesc else null
        
        if (!displayText.isNullOrEmpty() && displayText.length > 1) {
            val rect = android.graphics.Rect()
            node.getBoundsInScreen(rect)

            val xMinPct = if (screenWidth > 0) (rect.left.toFloat() / screenWidth) * 100 else 0f
            val yMinPct = if (screenHeight > 0) (rect.top.toFloat() / screenHeight) * 100 else 0f
            val yMaxPct = if (screenHeight > 0) (rect.bottom.toFloat() / screenHeight) * 100 else 0f

            // Filter rules based on screen percentages:
            // 1. Skip system status bar and top header bar (Y < 12%)
            // 2. Skip bottom navigation bar (Y > 92%)
            // 3. Skip right action sidebar (X > 75%)
            val isHeader = yMinPct < 12f
            val isFooter = yMaxPct > 92f
            val isRightSidebar = xMinPct > 75f

            if (!isHeader && !isFooter && !isRightSidebar) {
                nodes.add(NodeData(displayText, viewId))
            }
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            collectNodes(child, nodes, screenWidth, screenHeight)
            child?.recycle()
        }
    }

    override fun onInterrupt() {}

    data class NodeData(val text: String, val viewId: String)
}
