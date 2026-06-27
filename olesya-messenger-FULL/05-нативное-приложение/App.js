import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  SafeAreaView, StatusBar, ActivityIndicator,
  View, StyleSheet, BackHandler, Platform, Text, TouchableOpacity, Linking
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as Contacts from 'expo-contacts';

// Продакшн URL — Firebase auth работает с этого домена
const PROD_URL = 'https://vs2145061-dotcom.github.io/olesya/';

// Локальный HTML — резервный вариант (без Firebase auth, с Worker OTP)
const htmlModule = require('./assets/www/index.html');

// Мобильный User-Agent — соцсети отдают мобильную версию (она дружелюбнее к WebView)
const MOBILE_UA = Platform.select({
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  default: undefined,
});

function hostOf(u) { try { return new URL(u).host.replace(/^www\./, ''); } catch (e) { return u || ''; } }

export default function App() {
  const [source, setSource] = useState(null);
  const [online, setOnline] = useState(true);
  const wv = useRef(null);
  const canBack = useRef(false);

  // ── Встроенный браузер (для соцсетей, новостей и любых ссылок) ──
  const [browser, setBrowser] = useState(null);   // { url, title } | null
  const [bTitle, setBTitle] = useState('');
  const [bHost, setBHost] = useState('');
  const [bLoading, setBLoading] = useState(false);
  const bwv = useRef(null);
  const bCanBack = useRef(false);

  const openBrowser = useCallback((url, title) => {
    if (!url || !/^https?:\/\//i.test(url)) return;
    setBTitle(title || hostOf(url));
    setBHost(hostOf(url));
    setBLoading(true);
    bCanBack.current = false;
    setBrowser({ url, title: title || hostOf(url) });
  }, []);

  const closeBrowser = useCallback(() => { setBrowser(null); bCanBack.current = false; }, []);

  // Отправить данные обратно в страницу (PWA)
  const sendToPage = useCallback((obj) => {
    if (!wv.current) return;
    const enc = encodeURIComponent(JSON.stringify(obj));
    wv.current.injectJavaScript(
      `window.olesyaImportContacts && window.olesyaImportContacts(JSON.parse(decodeURIComponent("${enc}"))); true;`
    );
  }, []);

  // Импорт телефонной книги: читаем контакты устройства нативно (expo-contacts)
  const pickContacts = useCallback(async () => {
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') { sendToPage({ status: 'denied' }); return; }
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
      });
      const list = (data || [])
        .map(c => ({ name: c.name || '', tel: (c.phoneNumbers || []).map(p => p.number).filter(Boolean) }))
        .filter(c => c.tel.length);
      sendToPage({ status: 'ok', contacts: list });
    } catch (e) {
      sendToPage({ status: 'unavailable' });
    }
  }, [sendToPage]);

  // Сообщения из мессенджера (PWA внутри основного WebView)
  const onMessage = useCallback((e) => {
    let msg = null;
    try { msg = JSON.parse(e.nativeEvent.data); } catch (_) { return; }
    if (!msg) return;
    if (msg.type === 'open-browser' && msg.url) openBrowser(msg.url, msg.title);
    else if (msg.type === 'pick-contacts') pickContacts();
  }, [openBrowser, pickContacts]);

  useEffect(() => {
    (async () => {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 4000);
        const resp = await fetch(PROD_URL, { method: 'HEAD', signal: ctrl.signal });
        clearTimeout(to);
        if (resp.ok) { setSource({ uri: PROD_URL }); setOnline(true); return; }
      } catch (_) {}
      const a = Asset.fromModule(htmlModule);
      await a.downloadAsync();
      setSource({ uri: a.localUri || a.uri });
      setOnline(false);
    })();
  }, []);

  // Android: аппаратная «Назад» → сначала встроенный браузер, потом основной WebView
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (browser) {
        if (bCanBack.current && bwv.current) { bwv.current.goBack(); return true; }
        closeBrowser(); return true;
      }
      if (canBack.current && wv.current) { wv.current.goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [browser, closeBrowser]);

  // Скрипт-мост: на случай, если страница откроет ссылку напрямую (target=_blank и т.п.)
  const bridgeJS = `
    (function(){
      try{
        window.__OLESYA_NATIVE__ = true;
        window.olesyaOpenBrowser = function(url, title){
          try{ window.ReactNativeWebView.postMessage(JSON.stringify({type:'open-browser', url:url, title:title||''})); }catch(e){}
        };
      }catch(e){}
      true;
    })();`;

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0E1014" />
      {source ? (
        <WebView
          ref={wv}
          source={source}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          allowFileAccess
          allowUniversalAccessFromFileURLs
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo
          geolocationEnabled={false}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          onMessage={onMessage}
          injectedJavaScriptBeforeContentLoaded={bridgeJS}
          // открытие новой вкладки/окна внутри мессенджера → наш встроенный браузер
          onOpenWindow={(e) => {
            const u = e?.nativeEvent?.targetUrl;
            if (u && /^https?:\/\//i.test(u)) openBrowser(u, '');
          }}
          onNavigationStateChange={s => { canBack.current = s.canGoBack; }}
          onError={() => {
            if (online) {
              Asset.fromModule(htmlModule).downloadAsync().then(a => {
                setSource({ uri: a.localUri || a.uri });
                setOnline(false);
              });
            }
          }}
          style={styles.web}
        />
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#6C7BFF" />
          <Text style={styles.loadingText}>Загрузка мессенджера…</Text>
        </View>
      )}

      {/* ── Встроенный браузер: настоящий браузерный контекст (соцсети открываются как в браузере) ── */}
      {browser && (
        <View style={styles.browserWrap}>
          <View style={styles.bbar}>
            <TouchableOpacity style={styles.bbtn} onPress={closeBrowser} hitSlop={hit}>
              <Text style={styles.bclose}>✕</Text>
            </TouchableOpacity>
            <View style={styles.btitleWrap}>
              <Text style={styles.btitle} numberOfLines={1}>{bTitle || bHost}</Text>
              <View style={styles.brow}>
                <Text style={styles.block}>🔒 </Text>
                <Text style={styles.bhost} numberOfLines={1}>{bHost}</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.bbtn} onPress={() => bwv.current && bwv.current.reload()} hitSlop={hit}>
              <Text style={styles.bicon}>⟳</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.bbtn} onPress={() => Linking.openURL(browser.url)} hitSlop={hit}>
              <Text style={styles.bicon}>↗</Text>
            </TouchableOpacity>
          </View>
          {bLoading && (
            <View style={styles.bprogress}><View style={styles.bprogressBar} /></View>
          )}
          <WebView
            ref={bwv}
            source={{ uri: browser.url }}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            allowsFullscreenVideo
            allowsBackForwardNavigationGestures
            pullToRefreshEnabled
            userAgent={MOBILE_UA}
            setSupportMultipleWindows={false}
            onLoadStart={() => setBLoading(true)}
            onLoadEnd={() => setBLoading(false)}
            onNavigationStateChange={s => {
              bCanBack.current = s.canGoBack;
              if (s.title) setBTitle(s.title);
              if (s.url) setBHost(hostOf(s.url));
            }}
            style={styles.web}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const hit = { top: 10, bottom: 10, left: 10, right: 10 };

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: '#0E1014' },
  web:         { flex: 1, backgroundColor: '#0E1014' },
  loading:     { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0E1014', gap: 16 },
  loadingText: { color: '#6C7BFF', fontSize: 15, fontWeight: '600' },

  browserWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#0C0A14' },
  bbar:        { flexDirection: 'row', alignItems: 'center', height: 56, paddingHorizontal: 8, backgroundColor: '#15121E', borderBottomWidth: 1, borderBottomColor: '#241F33' },
  bbtn:        { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  bclose:      { color: '#E9E7F2', fontSize: 20, fontWeight: '700' },
  bicon:       { color: '#9A93B0', fontSize: 20, fontWeight: '700' },
  btitleWrap:  { flex: 1, paddingHorizontal: 6 },
  btitle:      { color: '#E9E7F2', fontSize: 15, fontWeight: '700' },
  brow:        { flexDirection: 'row', alignItems: 'center', marginTop: 1 },
  block:       { color: '#3FCF8E', fontSize: 10 },
  bhost:       { color: '#9A93B0', fontSize: 11 },
  bprogress:   { height: 2.5, backgroundColor: '#241F33' },
  bprogressBar:{ height: 2.5, width: '40%', backgroundColor: '#6C7BFF' },
});
