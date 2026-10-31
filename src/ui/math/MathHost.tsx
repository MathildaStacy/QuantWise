/** 隐藏的 WebView 宿主：在 App 根部挂一个，加载离线 MathJax，和 mathBridge 互传消息。 */
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { mathBridge } from './bridge';

const source = { uri: 'file:///android_asset/math/index.html' };
const origins = ['file://*'];

export function MathHost() {
  const webview = useRef<WebView<object>>(null);
  useEffect(
    () =>
      mathBridge.attach(payload => {
        if (!webview.current) {
          throw new Error('Math WebView unavailable');
        }
        webview.current.postMessage(payload);
      }),
    [],
  );
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={styles.hidden}
    >
      <WebView<object>
        ref={webview}
        source={source}
        style={styles.hidden}
        javaScriptEnabled
        allowFileAccess
        allowUniversalAccessFromFileURLs={false}
        domStorageEnabled={false}
        originWhitelist={origins}
        mixedContentMode="never"
        scrollEnabled={false}
        onMessage={event => mathBridge.receive(event.nativeEvent.data)}
        onError={() => mathBridge.fail()}
        onHttpError={() => mathBridge.fail()}
        onContentProcessDidTerminate={() => mathBridge.fail()}
        onRenderProcessGone={() => mathBridge.fail()}
        onShouldStartLoadWithRequest={request =>
          request.url === 'about:blank' ||
          request.url.startsWith('file:///android_asset/math/')
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 0, height: 0, opacity: 0 },
});
