import React, { useEffect, useState, useRef } from 'react';
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View,
  TouchableOpacity,
  TextInput,
  NativeModules,
  NativeEventEmitter,
  Clipboard,
  AppState,
  FlatList,
  ActivityIndicator,
  Share,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

const { ShortsExtractorModule } = NativeModules;
const extractorEmitter = new NativeEventEmitter(ShortsExtractorModule);

interface ExtractedTextItem {
  id: string;
  text: string;
  packageName: string;
  timestamp: number;
  creator?: string;
  caption?: string;
  hashtags?: string[];
  comments?: string[];
}

interface PlatformConfig {
  name: string;
  color: string;
  badgeBg: string;
  shortName: string;
}

const PLATFORM_MAP: Record<string, PlatformConfig> = {
  'com.google.android.youtube': {
    name: 'YouTube Shorts',
    color: '#ef4444',
    badgeBg: '#fef2f2',
    shortName: 'YouTube',
  },
  'com.zhiliaoapp.musically': {
    name: 'TikTok',
    color: '#06b6d4',
    badgeBg: '#ecfeff',
    shortName: 'TikTok',
  },
  'com.ss.android.ugc.trill': {
    name: 'TikTok',
    color: '#06b6d4',
    badgeBg: '#ecfeff',
    shortName: 'TikTok',
  },
  'com.instagram.android': {
    name: 'Instagram Reels',
    color: '#ec4899',
    badgeBg: '#fdf2f8',
    shortName: 'Instagram',
  },
  'com.facebook.katana': {
    name: 'Facebook Reels',
    color: '#3b82f6',
    badgeBg: '#eff6ff',
    shortName: 'Facebook',
  },
};

function getPlatformDetails(packageName: string): PlatformConfig {
  if (packageName in PLATFORM_MAP) {
    return PLATFORM_MAP[packageName];
  }
  
  // Generic check for common words
  const lowerPkg = packageName.toLowerCase();
  if (lowerPkg.includes('youtube')) {
    return PLATFORM_MAP['com.google.android.youtube'];
  }
  if (lowerPkg.includes('tiktok') || lowerPkg.includes('musically')) {
    return PLATFORM_MAP['com.zhiliaoapp.musically'];
  }
  if (lowerPkg.includes('instagram')) {
    return PLATFORM_MAP['com.instagram.android'];
  }
  if (lowerPkg.includes('facebook') || lowerPkg.includes('katana')) {
    return PLATFORM_MAP['com.facebook.katana'];
  }

  // Default other apps
  return {
    name: packageName ? (packageName.split('.').pop() || 'Other App') : 'Scraped Screen',
    color: '#8b5cf6',
    badgeBg: '#f5f3ff',
    shortName: 'Other',
  };
}

function App(): React.JSX.Element {
  const [extractedTexts, setExtractedTexts] = useState<ExtractedTextItem[]>([]);
  const [isServiceActive, setIsServiceActive] = useState<boolean>(false);
  const [isListening, setIsListening] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const appState = useRef(AppState.currentState);

  const checkServiceStatus = async () => {
    try {
      if (ShortsExtractorModule && ShortsExtractorModule.isAccessibilityServiceEnabled) {
        const isEnabled = await ShortsExtractorModule.isAccessibilityServiceEnabled();
        setIsServiceActive(isEnabled);
      }
    } catch (e) {
      console.error('Error checking service status:', e);
    }
  };

  const handleEnableService = () => {
    if (ShortsExtractorModule && ShortsExtractorModule.openAccessibilitySettings) {
      ShortsExtractorModule.openAccessibilitySettings();
    }
  };

  // Monitor App state to re-check accessibility status when user returns from settings
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        checkServiceStatus();
      }
      appState.current = nextAppState;
    });

    checkServiceStatus();
    
    // Periodically poll service status every 3 seconds as backup
    const interval = setInterval(checkServiceStatus, 3000);

    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, []);

  // Listen to Accessibility Service events
  useEffect(() => {
    let subscription: any;
    try {
      subscription = extractorEmitter.addListener(
        'onTextExtracted',
        (payload: any) => {
          if (!isListening) return;

          // Payload can be a raw string (as in original specification) or a map
          let text = '';
          let packageName = '';
          let timestamp = Date.now();
          let creator = '';
          let caption = '';
          let hashtags: string[] = [];
          let comments: string[] = [];

          if (typeof payload === 'string') {
            text = payload;
          } else if (payload && typeof payload === 'object') {
            text = payload.text || '';
            packageName = payload.packageName || '';
            timestamp = payload.timestamp || Date.now();
            creator = payload.creator || '';
            caption = payload.caption || '';
            hashtags = payload.hashtags || [];
            comments = payload.comments || [];
          }

          if (!text.trim()) return;

          // Prevent duplicate consecutive entries if text is identical
          setExtractedTexts(prev => {
            if (prev.length > 0 && prev[0].text === text) {
              return prev;
            }
            
            const newItem: ExtractedTextItem = {
              id: `${timestamp}-${Math.random().toString(36).substr(2, 9)}`,
              text,
              packageName,
              timestamp,
              creator,
              caption,
              hashtags,
              comments,
            };
            return [newItem, ...prev];
          });
        }
      );
    } catch (e) {
      console.error('Failed to attach accessibility listener:', e);
    }

    return () => {
      if (subscription) {
        subscription.remove();
      }
    };
  }, [isListening]);

  const handleCopy = (id: string, text: string) => {
    Clipboard.setString(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleClearHistory = () => {
    setExtractedTexts([]);
  };

  const handleShareHistory = async () => {
    if (extractedTexts.length === 0) return;
    try {
      const formattedTexts = extractedTexts
        .map(item => {
          const date = new Date(item.timestamp).toLocaleTimeString();
          const details = getPlatformDetails(item.packageName);
          return `[${date}] [${details.name}]\n${item.text}\n-------------------`;
        })
        .join('\n\n');
      
      await Share.share({
        message: formattedTexts,
        title: 'Extracted Texts Log',
      });
    } catch (error) {
      console.error('Error sharing history:', error);
    }
  };

  // Filter text logic
  const filteredTexts = extractedTexts.filter(item => {
    // Search query match
    const matchesSearch = item.text.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (!matchesSearch) return false;

    // Platform badge match
    if (selectedPlatform === 'all') return true;
    
    const details = getPlatformDetails(item.packageName);
    const shortName = details.shortName.toLowerCase();
    
    if (selectedPlatform === 'youtube') return shortName === 'youtube';
    if (selectedPlatform === 'tiktok') return shortName === 'tiktok';
    if (selectedPlatform === 'instagram') return shortName === 'instagram';
    if (selectedPlatform === 'facebook') return shortName === 'facebook';
    if (selectedPlatform === 'others') {
      return !['youtube', 'tiktok', 'instagram', 'facebook'].includes(shortName);
    }
    
    return true;
  });

  // Calculate stats
  const getStats = () => {
    const stats = { youtube: 0, tiktok: 0, instagram: 0, others: 0 };
    extractedTexts.forEach(item => {
      const details = getPlatformDetails(item.packageName);
      const shortName = details.shortName.toLowerCase();
      if (shortName === 'youtube') stats.youtube++;
      else if (shortName === 'tiktok') stats.tiktok++;
      else if (shortName === 'instagram') stats.instagram++;
      else stats.others++;
    });
    return stats;
  };

  const stats = getStats();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0b0f19" />
      
      {/* Premium Dashboard Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>TEXT SCRAPER</Text>
          <Text style={styles.headerSubtitle}>Video Accessibility Engine</Text>
        </View>
        
        {/* Pulsing Status badge */}
        <View style={[styles.statusBadge, isServiceActive ? styles.statusBadgeActive : styles.statusBadgeInactive]}>
          <View style={[styles.statusDot, isServiceActive ? styles.statusDotActive : styles.statusDotInactive]} />
          <Text style={[styles.statusText, isServiceActive ? styles.statusTextActive : styles.statusTextInactive]}>
            {isServiceActive ? 'ENGINE ACTIVE' : 'INACTIVE'}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        {/* Status Action Card */}
        {!isServiceActive && (
          <View style={styles.alertCard}>
            <View style={styles.alertHeader}>
              <View style={styles.alertIconBg}>
                <Text style={styles.alertIcon}>⚠️</Text>
              </View>
              <View style={styles.alertTextContainer}>
                <Text style={styles.alertTitle}>Accessibility Service Disabled</Text>
                <Text style={styles.alertDescription}>
                  Enable the service in system settings so the engine can capture text scrolling on screen in short video apps.
                </Text>
              </View>
            </View>
            <TouchableOpacity style={styles.alertButton} onPress={handleEnableService}>
              <Text style={styles.alertButtonText}>Enable in Settings ➡️</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Listen status control toggle */}
        {isServiceActive && (
          <View style={styles.listeningCard}>
            <View style={styles.listeningHeader}>
              <View style={[styles.pulseCircle, isListening ? styles.pulseCircleGreen : styles.pulseCircleGrey]} />
              <View>
                <Text style={styles.listeningTitle}>
                  {isListening ? 'Scraping Active & Listening' : 'Scraping Paused'}
                </Text>
                <Text style={styles.listeningSub}>
                  {isListening ? 'Open YouTube, TikTok, or Instagram to capture text.' : 'Resume to start capturing text again.'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.listenToggleBtn, isListening ? styles.listenToggleBtnPause : styles.listenToggleBtnResume]}
              onPress={() => setIsListening(!isListening)}
            >
              <Text style={styles.listenToggleBtnText}>
                {isListening ? '⏸️ Pause' : '▶️ Resume'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Search Bar */}
        <View style={styles.searchSection}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search extracted texts..."
            placeholderTextColor="#64748b"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearSearch}>
              <Text style={styles.clearSearchText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Platform scroll filters */}
        <View style={styles.filterContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
            {[
              { id: 'all', label: 'All', count: extractedTexts.length },
              { id: 'youtube', label: 'YouTube', count: stats.youtube },
              { id: 'tiktok', label: 'TikTok', count: stats.tiktok },
              { id: 'instagram', label: 'Instagram', count: stats.instagram },
              { id: 'others', label: 'Others', count: stats.others },
            ].map(platform => (
              <TouchableOpacity
                key={platform.id}
                style={[
                  styles.filterTab,
                  selectedPlatform === platform.id && styles.filterTabSelected,
                ]}
                onPress={() => setSelectedPlatform(platform.id)}
              >
                <Text
                  style={[
                    styles.filterTabLabel,
                    selectedPlatform === platform.id && styles.filterTabLabelSelected,
                  ]}
                >
                  {platform.label}
                </Text>
                <View
                  style={[
                    styles.filterCountBadge,
                    selectedPlatform === platform.id ? styles.filterCountBadgeSelected : styles.filterCountBadgeNormal,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterCountText,
                      selectedPlatform === platform.id ? styles.filterCountTextSelected : styles.filterCountTextNormal,
                    ]}
                  >
                    {platform.count}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Log Controls */}
        {extractedTexts.length > 0 && (
          <View style={styles.controlsRow}>
            <Text style={styles.resultsCount}>
              Showing {filteredTexts.length} logs
            </Text>
            <View style={styles.controlsActions}>
              <TouchableOpacity style={styles.controlBtnShare} onPress={handleShareHistory}>
                <Text style={styles.controlBtnText}>📤 Export</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.controlBtnClear} onPress={handleClearHistory}>
                <Text style={styles.controlBtnText}>🗑️ Clear</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Scraped Feeds */}
        {filteredTexts.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📱</Text>
            <Text style={styles.emptyTitle}>No Scraped Text Found</Text>
            <Text style={styles.emptyDescription}>
              {searchQuery || selectedPlatform !== 'all'
                ? 'Try adjusting your search query or filter tags.'
                : 'Scraped screen text will appear here in real-time once you activate the accessibility service.'}
            </Text>
          </View>
        ) : (
          filteredTexts.map(item => {
            const platform = getPlatformDetails(item.packageName);
            const isItemCopied = copiedId === item.id;
            const timeString = new Date(item.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });

             const hasStructured = !!(item.creator || item.caption || (item.hashtags && item.hashtags.length > 0) || (item.comments && item.comments.length > 0));

             return (
               <View key={item.id} style={styles.logCard}>
                 <View style={styles.logCardHeader}>
                   <View style={[styles.platformBadge, { backgroundColor: platform.badgeBg }]}>
                     <View style={[styles.platformDot, { backgroundColor: platform.color }]} />
                     <Text style={[styles.platformText, { color: platform.color }]}>
                       {platform.name}
                     </Text>
                   </View>
                   <Text style={styles.logTime}>{timeString}</Text>
                 </View>
                 
                 {hasStructured ? (
                   <View style={styles.structuredContainer}>
                     {!!item.creator && (
                       <View style={styles.creatorRow}>
                         <Text style={styles.creatorIcon}>👤</Text>
                         <Text style={styles.creatorText} selectable={true}>
                           {item.creator}
                         </Text>
                       </View>
                     )}
                     
                     {!!item.caption && (
                       <View style={styles.captionContainer}>
                         <Text style={styles.captionLabel}>Caption</Text>
                         <Text style={styles.captionText} selectable={true}>
                           {item.caption}
                         </Text>
                       </View>
                     )}

                     {!!item.hashtags && item.hashtags.length > 0 && (
                       <View style={styles.tagContainer}>
                         {item.hashtags.map((tag, idx) => (
                           <View key={idx} style={styles.tagBadge}>
                             <Text style={styles.tagText}>{tag}</Text>
                           </View>
                         ))}
                       </View>
                     )}

                     {!!item.comments && item.comments.length > 0 && (
                       <View style={styles.commentsSection}>
                         <Text style={styles.commentsTitle}>💬 Top Comments</Text>
                         {item.comments.map((comment, idx) => (
                           <View key={idx} style={styles.commentItem}>
                             <Text style={styles.commentText} selectable={true}>
                               {comment}
                             </Text>
                           </View>
                         ))}
                       </View>
                     )}
                   </View>
                 ) : (
                   <Text style={styles.logText} selectable={true}>
                     {item.text}
                   </Text>
                 )}

                 <View style={styles.logCardFooter}>
                   <TouchableOpacity
                     style={[styles.copyBtn, isItemCopied && styles.copyBtnCopied]}
                     onPress={() => handleCopy(item.id, hasStructured ? `${item.creator ? `Creator: ${item.creator}\n` : ''}${item.caption ? `Caption: ${item.caption}\n` : ''}${item.hashtags && item.hashtags.length > 0 ? `Tags: ${item.hashtags.join(' ')}\n` : ''}${item.comments && item.comments.length > 0 ? `Comments:\n${item.comments.map(c => `- ${c}`).join('\n')}` : ''}`.trim() : item.text)}
                   >
                     <Text style={[styles.copyBtnText, isItemCopied && styles.copyBtnTextCopied]}>
                       {isItemCopied ? '✓ Copied' : '📋 Copy Text'}
                     </Text>
                   </TouchableOpacity>
                 </View>
               </View>
             );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0f19',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1.5,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  statusBadgeActive: {
    backgroundColor: '#064e3b',
  },
  statusBadgeInactive: {
    backgroundColor: '#451a03',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusDotActive: {
    backgroundColor: '#10b981',
  },
  statusDotInactive: {
    backgroundColor: '#f59e0b',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
  },
  statusTextActive: {
    color: '#34d399',
  },
  statusTextInactive: {
    color: '#fbbf24',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  alertCard: {
    backgroundColor: '#1e1b4b',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#4338ca',
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  alertIconBg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#312e81',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  alertIcon: {
    fontSize: 16,
  },
  alertTextContainer: {
    flex: 1,
  },
  alertTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 4,
  },
  alertDescription: {
    fontSize: 12,
    color: '#a5b4fc',
    lineHeight: 18,
  },
  alertButton: {
    backgroundColor: '#6366f1',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 14,
  },
  alertButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  listeningCard: {
    backgroundColor: '#161e2e',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#1e293b',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  listeningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  pulseCircle: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
  },
  pulseCircleGreen: {
    backgroundColor: '#10b981',
  },
  pulseCircleGrey: {
    backgroundColor: '#64748b',
  },
  listeningTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  listeningSub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  listenToggleBtn: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  listenToggleBtnPause: {
    backgroundColor: '#1e293b',
  },
  listenToggleBtnResume: {
    backgroundColor: '#047857',
  },
  listenToggleBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  searchSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161e2e',
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  searchIcon: {
    fontSize: 14,
    color: '#64748b',
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 44,
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
  },
  clearSearch: {
    padding: 6,
  },
  clearSearchText: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: 'bold',
  },
  filterContainer: {
    marginBottom: 20,
  },
  filterScroll: {
    gap: 8,
  },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#161e2e',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  filterTabSelected: {
    backgroundColor: '#4f46e5',
    borderColor: '#6366f1',
  },
  filterTabLabel: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '600',
  },
  filterTabLabelSelected: {
    color: '#ffffff',
    fontWeight: '700',
  },
  filterCountBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 6,
  },
  filterCountBadgeNormal: {
    backgroundColor: '#1e293b',
  },
  filterCountBadgeSelected: {
    backgroundColor: '#312e81',
  },
  filterCountText: {
    fontSize: 10,
    fontWeight: '800',
  },
  filterCountTextNormal: {
    color: '#94a3b8',
  },
  filterCountTextSelected: {
    color: '#a5b4fc',
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  resultsCount: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '600',
  },
  controlsActions: {
    flexDirection: 'row',
    gap: 8,
  },
  controlBtnShare: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  controlBtnClear: {
    backgroundColor: '#7f1d1d',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  controlBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
    opacity: 0.8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 6,
  },
  emptyDescription: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
  },
  logCard: {
    backgroundColor: '#161e2e',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  logCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  platformBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  platformDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  platformText: {
    fontSize: 10,
    fontWeight: '800',
  },
  logTime: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  logText: {
    fontSize: 14,
    color: '#f8fafc',
    lineHeight: 22,
    fontWeight: '400',
  },
  logCardFooter: {
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    marginTop: 12,
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  copyBtn: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  copyBtnCopied: {
    backgroundColor: '#065f46',
  },
  copyBtnText: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '700',
  },
  copyBtnTextCopied: {
    color: '#a7f3d0',
  },
  structuredContainer: {
    marginTop: 4,
    gap: 12,
  },
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  creatorIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  creatorText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#38bdf8',
  },
  captionContainer: {
    backgroundColor: '#0f172a',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  captionLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  captionText: {
    fontSize: 14,
    color: '#f1f5f9',
    lineHeight: 20,
  },
  tagContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tagBadge: {
    backgroundColor: '#1e1b4b',
    borderWidth: 1,
    borderColor: '#312e81',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#818cf8',
  },
  commentsSection: {
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    paddingTop: 10,
  },
  commentsTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#64748b',
    marginBottom: 8,
  },
  commentItem: {
    backgroundColor: '#0f172a',
    padding: 10,
    borderRadius: 8,
    marginBottom: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#4f46e5',
  },
  commentText: {
    fontSize: 13,
    color: '#cbd5e1',
    lineHeight: 18,
  },
});

export default App;
