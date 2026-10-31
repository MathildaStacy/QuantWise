/* 把 MathJax 3 的离线资源复制进 Android APK（QUANTWISE_DESIGN.md §9）：不用 CDN，运行时不下载。来自 Pagewise。 */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.dirname(require.resolve('mathjax/package.json'));
const destination = path.join(root, 'android/app/src/main/assets/math');
const version = require(path.join(source, 'package.json')).version;
if (!version.startsWith('3.')) throw new Error('QuantWise requires MathJax 3');
fs.mkdirSync(destination, { recursive: true });
fs.copyFileSync(
  path.join(source, 'es5/tex-svg.js'),
  path.join(destination, 'tex-svg.js'),
);
fs.copyFileSync(
  path.join(source, 'LICENSE'),
  path.join(destination, 'LICENSE'),
);
fs.writeFileSync(path.join(destination, 'version.txt'), version + '\n');
fs.writeFileSync(
  path.join(destination, 'index.html'),
  `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>QuantWise Math</title>
<script>
(function () {
  function post(value) { window.ReactNativeWebView.postMessage(JSON.stringify(value)); }
  var queue = Promise.resolve();
  var active = new Set();
  function receive(event) {
    var request;
    try { request = JSON.parse(event.data); } catch (_) { return; }
    if (!request || typeof request.id !== 'string' || typeof request.tex !== 'string' || active.has(request.id)) return;
    active.add(request.id);
    queue = queue.then(function () {
      return MathJax.tex2svgPromise(request.tex, { display: !!request.display, em: 16, ex: 8, containerWidth: 1000 }).then(function (node) {
        var svg = node.querySelector('svg');
        if (!svg || node.querySelector('[data-mjx-error], [data-mml-node="merror"]')) throw new Error('TeX error');
        var width = parseFloat(svg.getAttribute('width'));
        var height = parseFloat(svg.getAttribute('height'));
        var depth = Math.abs(parseFloat(svg.style.verticalAlign) || 0);
        post({ id: request.id, svg: svg.outerHTML, w: width, h: height, baseline: height - depth });
      });
    }).catch(function () { post({ id: request.id, error: 'render' }); }).then(function () { active.delete(request.id); });
  }
  document.addEventListener('message', receive);
  window.addEventListener('message', receive);
  window.MathJax = {
    tex: { packages: ['base', 'ams', 'newcommand'], formatError: function (_jax, error) { throw error; } },
    svg: { fontCache: 'none' },
    options: { enableMenu: false },
    startup: {
      typeset: false,
      ready: function () {
        MathJax.startup.defaultReady();
        MathJax.startup.promise.then(function () { post({ type: 'ready' }); }).catch(function () { post({ type: 'fatal' }); });
      }
    }
  };
}());
</script><script src="tex-svg.js"></script></head><body></body></html>
`,
);
process.stdout.write('Bundled offline MathJax ' + version + '\n');
