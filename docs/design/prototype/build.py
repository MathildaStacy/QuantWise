"""把原型源文件拼成单文件 docs/design/prototype.html。用法：python3 build.py
示例教材的正文从 src/book/sample.ts 里取，原型和 App 用同一份内容。"""
import json, pathlib, re
here = pathlib.Path(__file__).resolve().parent
shell = (here / "shell.html").read_text(encoding="utf-8")
data = json.loads((here / "snapshot-2026-10-26.json").read_text(encoding="utf-8"))
sample = (here.parents[2] / "src" / "book" / "sample.ts").read_text(encoding="utf-8")
md = re.search(r"String\.raw`(.*?)`;", sample, re.S).group(1)
files = ["core.js", "ui-base.js", "ui-market.js", "ui-trade.js", "ui-learn.js", "ui-ai.js",
         "quant.js", "ui-book.js", "ui-shelf.js", "ui-shelf2.js", "ui-study.js", "ui-study2.js", "ui-study3.js", "ui-factor.js", "ui-me.js"]
js = "const SAMPLE_MD = " + json.dumps(md, ensure_ascii=False) + ";\n" + "\n".join((here / f).read_text(encoding="utf-8") for f in files)
out = shell.replace("/*DATA*/", json.dumps(data, ensure_ascii=False, separators=(",", ":"))).replace("/*JS*/", js.replace("</script>", "<\\/script>"))
(here.parent / "prototype.html").write_text(out, encoding="utf-8")
print("wrote", here.parent / "prototype.html", len(out) // 1024, "KB")
