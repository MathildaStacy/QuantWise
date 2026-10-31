/**
 * EPUB 解析：用内存里的「路径 → 文本」拼出解压后的 EPUB（不用 zip），
 * 核对目录定的标题层级、目录没列出的小节、各类正文块和警告。
 */
import type { RawBlock, RawDoc } from '../../src/book/types';
import {
  EpubError,
  parseEpubDir,
  type EpubIo,
} from '../../src/study/import/epub';

const DIR = '/books/b1';

function memIo(files: Record<string, string>): EpubIo {
  const local = (path: string) =>
    path.startsWith(`${DIR}/`) ? path.slice(DIR.length + 1) : '';
  return {
    readText: async path => {
      const key = local(path);
      if (!(key in files)) {
        throw new Error(`ENOENT ${path}`);
      }
      return files[key];
    },
    exists: async path => local(path) in files,
  };
}

const parse = (files: Record<string, string>) =>
  parseEpubDir(DIR, memIo(files));

const container = (opfPath = 'OEBPS/content.opf') => `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

function opf(o: {
  title?: string;
  author?: string;
  items: string;
  spine: string;
  toc?: string;
}) {
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    ${o.title ? `<dc:title>${o.title}</dc:title>` : ''}
    ${o.author ? `<dc:creator>${o.author}</dc:creator>` : ''}
  </metadata>
  <manifest>${o.items}</manifest>
  <spine${o.toc ? ` toc="${o.toc}"` : ''}>${o.spine}</spine>
</package>`;
}

const item = (
  id: string,
  href: string,
  type = 'application/xhtml+xml',
  props = '',
) =>
  `<item id="${id}" href="${href}" media-type="${type}"${
    props ? ` properties="${props}"` : ''
  }/>`;
const ref = (id: string, linear = true) =>
  `<itemref idref="${id}"${linear ? '' : ' linear="no"'}/>`;

const xhtml = (body: string) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>t</title><style>p { margin: 0 }</style><script>ignored()</script></head>
<body>${body}</body></html>`;

/** 没有目录的一章书：测各类正文块用（h1–h3 按标签）。 */
function simpleBook(body: string, extra: Record<string, string> = {}) {
  return {
    'META-INF/container.xml': container(),
    'OEBPS/content.opf': opf({
      title: '书',
      author: '作者',
      items: item('c1', 'text/c1.xhtml'),
      spine: ref('c1'),
    }),
    'OEBPS/text/c1.xhtml': xhtml(body),
    ...extra,
  };
}

/** EPUB3：nav 在 OEBPS/nav.xhtml，正文在 OEBPS/text/。 */
function navBook(navBody: string, chapters: Record<string, string>) {
  const ids = Object.keys(chapters);
  return {
    'META-INF/container.xml': container(),
    'OEBPS/content.opf': opf({
      title: '测试书',
      author: '张三',
      items:
        item('nav', 'nav.xhtml', 'application/xhtml+xml', 'nav') +
        ids.map(id => item(id, `text/${id}.xhtml`)).join(''),
      spine: ids.map(id => ref(id)).join(''),
    }),
    'OEBPS/nav.xhtml': xhtml(navBody),
    ...Object.fromEntries(
      ids.map(id => [`OEBPS/text/${id}.xhtml`, xhtml(chapters[id])]),
    ),
  };
}

/** 每项缩成一行方便整体比对：「H2 1.1 定义」「p 正文」「li 3. 三」。 */
const brief = (doc: RawDoc) =>
  doc.items.map(i =>
    i.kind === 'heading'
      ? `H${i.level} ${i.text}`
      : `${i.type}${i.mark ? ` ${i.mark}` : ''} ${i.text}`,
  );
const blocksOf = (doc: RawDoc, type: string) =>
  doc.items.filter((i): i is RawBlock => i.kind === 'block' && i.type === type);

describe('目录定标题', () => {
  it('EPUB3 nav：章 + 同一文件里用锚点分的节；目录标题去掉页码，目录没列的 h2 当加粗段落、h3 当小节', async () => {
    const doc = await parse(
      navBook(
        `<nav epub:type="landmarks"><ol><li><a href="text/ch1.xhtml">正文</a></li></ol></nav>
         <nav epub:type="toc"><h1>目录</h1><ol>
           <li><a href="text/ch1.xhtml">第 1 章 动量</a><ol>
             <li><a href="text/ch1.xhtml#s1">1.1 定义</a></li>
             <li><a href="text/ch1.xhtml#s2">1.2 计算 ........ 12</a></li>
           </ol></li>
           <li><a href="text/ch2.xhtml#c2">第 2 章 反转</a></li>
         </ol></nav>`,
        {
          ch1: `<section><h1>第 1 章
                  <span>动量</span></h1>
                <p>动量是什么。</p>
                <section id="s1"><h2>1.1 定义</h2><p>过去 <b>12 个月</b>的收益。</p></section>
                <h2 id="s2"><a id="calc"/>1.2 计算</h2><p>算法如下。</p>
                <h2>延伸阅读</h2><p>几本书。</p>
                <h3>小贴士</h3><p>注意停牌。</p></section>`,
          ch2: `<h1 id="c2">第 2 章 反转<a epub:type="noteref" href="#n1"><sup>1</sup></a></h1>
                <p>短期反转。</p>
                <aside epub:type="footnote" id="n1"><p>脚注内容</p></aside>`,
        },
      ),
    );
    expect(doc.title).toBe('测试书');
    expect(doc.author).toBe('张三');
    expect(brief(doc)).toEqual([
      'H1 第 1 章 动量',
      'p 动量是什么。',
      'H2 1.1 定义',
      'p 过去 **12 个月**的收益。',
      'H2 1.2 计算',
      'p 算法如下。',
      'p **延伸阅读**',
      'p 几本书。',
      'H3 小贴士',
      'p 注意停牌。',
      'H1 第 2 章 反转',
      'p 短期反转。',
    ]);
    expect(doc.warnings).toEqual([]);
  });

  it('EPUB2 NCX：../ 和 %20 路径、中文锚点、linear="no" 跳过', async () => {
    const doc = await parse({
      'META-INF/container.xml': container('OPS/content.opf'),
      'OPS/content.opf': opf({
        title: 'NCX 书',
        author: 'Li',
        toc: 'ncx',
        items:
          item('ncx', 'toc.ncx', 'application/x-dtbncx+xml') +
          item('c1', 'Text/chapter%20one.xhtml') +
          item('notes', 'Text/notes.xhtml') +
          item('fig', 'Images/fig%201.png', 'image/png'),
        spine: ref('c1') + ref('notes', false),
      }),
      'OPS/toc.ncx': `<?xml version="1.0"?>
        <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
          <navPoint id="p1"><navLabel><text>Chapter 1 First</text></navLabel>
            <content src="Text/chapter%20one.xhtml"/>
            <navPoint id="p2"><navLabel><text>1.1 原理</text></navLabel>
              <content src="Text/chapter%20one.xhtml#%E5%8E%9F%E7%90%86"/></navPoint>
          </navPoint>
        </navMap></ncx>`,
      'OPS/Text/chapter one.xhtml': xhtml(
        `<h1>First</h1><p>Opening.</p>
         <h2 id="原理">原理</h2><p><img src="../Images/fig%201.png" alt="示意图"/></p><p>正文。</p>`,
      ),
      'OPS/Text/notes.xhtml': xhtml('<p>不在主线里的注释</p>'),
      'OPS/Images/fig 1.png': 'PNG',
    });
    expect(brief(doc)).toEqual([
      'H1 Chapter 1 First',
      'p Opening.',
      'H2 1.1 原理',
      'img 示意图',
      'p 正文。',
    ]);
    expect(blocksOf(doc, 'img')[0].image).toBe('OPS/Images/fig 1.png');
    expect(doc.warnings).toEqual([]);
  });

  it('没有目录：h1–h3 按标签当标题，h4 当加粗段落；书名取第一个标题，作者「未知作者」', async () => {
    const doc = await parse({
      'META-INF/container.xml': container(),
      'OEBPS/content.opf': opf({
        items: item('a', 'a.xhtml') + item('b', 'b.xhtml'),
        spine: ref('a') + ref('b'),
      }),
      'OEBPS/a.xhtml': xhtml(
        `<h1>  Book
           Heading </h1><p>Intro.</p><h2>Part A</h2><p>a</p>`,
      ),
      'OEBPS/b.xhtml': xhtml('<h3>Deep</h3><p>b</p><h4>Minor</h4><p>c</p>'),
    });
    expect(doc.title).toBe('Book Heading');
    expect(doc.author).toBe('未知作者');
    expect(brief(doc)).toEqual([
      'H1 Book Heading',
      'p Intro.',
      'H2 Part A',
      'p a',
      'H3 Deep',
      'p b',
      'p **Minor**',
      'p c',
    ]);
  });

  it('只列到章的目录：正文里带编号的 h2 / h3 仍是节和小节，正文标题更全时用正文的', async () => {
    const doc = await parse(
      navBook(
        `<nav epub:type="toc"><ol>
           <li><a href="text/ch3.xhtml">第 3 章</a></li>
           <li><a href="text/ch4.xhtml">第 4 章 规模</a></li>
         </ol></nav>`,
        {
          ch3: `<h1>第 3 章 动量与反转</h1><p>引言。</p>
                <h2>3.1 动量因子</h2><p>a</p>
                <h3>3.1.2 计算</h3><p>b</p>
                <h2>延伸阅读</h2><p>c</p>`,
          // 文件直接从第一节开始，没有章标题
          ch4: '<h2>4.1 市值</h2><p>d</p>',
        },
      ),
    );
    expect(brief(doc)).toEqual([
      'H1 第 3 章 动量与反转',
      'p 引言。',
      'H2 3.1 动量因子',
      'p a',
      'H3 3.1.2 计算',
      'p b',
      'H2 延伸阅读',
      'p c',
      'H1 第 4 章 规模',
      'H2 4.1 市值',
      'p d',
    ]);
  });

  it('目录里没有链接的「部分」挂在它第一章前面，章节层级跟着往下', async () => {
    const doc = await parse(
      navBook(
        `<nav epub:type="toc"><ol>
           <li><span>第一部分 基础</span><ol>
             <li><a href="text/ch1.xhtml">第 1 章 收益</a><ol>
               <li><a href="text/ch1.xhtml#s11">1.1 简单收益</a></li>
             </ol></li>
           </ol></li>
         </ol></nav>`,
        {
          ch1: `<h1>第 1 章 收益</h1><p>a</p>
                <h2 id="s11">1.1 简单收益</h2><p>b</p>
                <h3>小结</h3><p>c</p>`,
        },
      ),
    );
    expect(brief(doc)).toEqual([
      'H1 第一部分 基础',
      'H2 第 1 章 收益',
      'p a',
      'H3 1.1 简单收益',
      'p b',
      'p **小结**',
      'p c',
    ]);
  });

  it('目录锚点找不到：提示，其余照常', async () => {
    const doc = await parse(
      navBook(
        `<nav epub:type="toc"><ol>
           <li><a href="text/ch1.xhtml">第 1 章 A</a><ol>
             <li><a href="text/ch1.xhtml#nope">1.1 B</a></li>
           </ol></li>
         </ol></nav>`,
        { ch1: '<h1>第 1 章 A</h1><p>a</p><h2>1.1 B</h2><p>b</p>' },
      ),
    );
    expect(brief(doc)).toEqual(['H1 第 1 章 A', 'p a', 'H2 1.1 B', 'p b']);
    expect(doc.warnings).toEqual([
      '目录有 1 项在正文里找不到位置：「1.1 B」→ OEBPS/text/ch1.xhtml#nope',
    ]);
  });

  it('目录一项都对不上正文：提示并改用 h1–h3', async () => {
    const doc = await parse(
      navBook(
        `<nav epub:type="toc"><ol><li><a href="text/gone.xhtml">X</a></li></ol></nav>`,
        { ch1: '<h1>Only</h1><p>a</p><h2>Sub</h2><p>b</p>' },
      ),
    );
    expect(brief(doc)).toEqual(['H1 Only', 'p a', 'H2 Sub', 'p b']);
    expect(doc.warnings).toEqual([
      '目录和正文对不上，改用正文里的 h1–h3 当标题',
    ]);
  });

  it('锚点在标题前的 <a id> 上；章名前有花饰图、写法和目录不同时不重复成章', async () => {
    const doc = await parse({
      ...navBook(
        `<nav epub:type="toc"><ol>
           <li><a href="text/ch1.xhtml#c1">Chapter 1 Loomings</a></li>
           <li><a href="text/ch2.xhtml">Chapter 2</a></li>
         </ol></nav>`,
        {
          ch1: '<a id="c1"></a><h2>Chapter 1 Loomings</h2><p>a</p>',
          ch2: `<div><img src="../images/orn.png" alt=""/></div>
                <h2>CHAPTER II.</h2><p>b</p><h3>Notes</h3><p>c</p>`,
        },
      ),
      'OEBPS/images/orn.png': 'x',
    });
    expect(brief(doc)).toEqual([
      'H1 Chapter 1 Loomings',
      'p a',
      'H1 Chapter 2',
      'img ',
      'p **CHAPTER II.**',
      'p b',
      'H2 Notes',
      'p c',
    ]);
  });
});

describe('正文块', () => {
  it('列表：ul「•」、ol 从 start 数、li value 改号、嵌套按顺序摊平', async () => {
    const doc = await parse(
      simpleBook(`
        <ul>
          <li>First <b>step</b>
            <ul><li>Nested</li></ul>
          </li>
          <li>Second</li>
        </ul>
        <ol start="3"><li>三</li><li>四</li><li value="10">十</li><li>十一</li></ol>
        <ol>
          <li><p>para one</p><p>para two</p></li>
          <li><ol><li>inner</li></ol>tail</li>
        </ol>`),
    );
    expect(brief(doc)).toEqual([
      'li • First **step**',
      'li • Nested',
      'li • Second',
      'li 3. 三',
      'li 4. 四',
      'li 10. 十',
      'li 11. 十一',
      'li 1. para one',
      'p para two',
      'li 1. inner',
      'li 2. tail',
    ]);
  });

  it('表格：html 原样，text 每行「 | 」连接', async () => {
    const doc = await parse(
      simpleBook(`<table id="t1"><caption>表 1</caption>
        <thead><tr><th>因子</th><th>含义</th></tr></thead>
        <tbody><tr><td>MOM</td><td><b>动量</b></td></tr>
        <tr><td>REV</td><td>反转<br/>短期</td></tr></tbody></table>`),
    );
    const [table] = blocksOf(doc, 'table');
    expect(table.text).toBe('因子 | 含义\nMOM | 动量\nREV | 反转 短期');
    expect(table.html).toMatch(/^<table id="t1">/);
    expect(table.html).toContain('<td><b>动量</b></td>');
    expect(doc.items).toHaveLength(1);
  });

  it('图：figcaption 当图注且不再单独成段，没有图注用 alt，<svg><image> 也算图', async () => {
    const doc = await parse(
      simpleBook(
        `<figure><img src="../images/f1.png" alt="alt 文字"/>
           <figcaption>图 1：<b>累计</b>收益</figcaption></figure>
         <p>正文 <img src="../images/f2.png" alt="小图"/> 接着</p>
         <div><svg xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="../images/f3.jpg"/></svg></div>
         <figure><figcaption>只有说明的 figure</figcaption></figure>`,
        {
          'OEBPS/images/f1.png': 'x',
          'OEBPS/images/f2.png': 'x',
          'OEBPS/images/f3.jpg': 'x',
        },
      ),
    );
    expect(brief(doc)).toEqual([
      'img 图 1：累计收益',
      'p 正文',
      'img 小图',
      'p 接着',
      'img ',
      'p 只有说明的 figure',
    ]);
    expect(blocksOf(doc, 'img').map(b => b.image)).toEqual([
      'OEBPS/images/f1.png',
      'OEBPS/images/f2.png',
      'OEBPS/images/f3.jpg',
    ]);
    expect(doc.warnings).toEqual([]);
  });

  it('MathML：行内写成 $tex$，独立公式和只有一个公式的段落是 eq', async () => {
    const doc = await parse(
      simpleBook(`
        <p>收益 <math alttext="r_t"><mi>r</mi><msub><mi>t</mi></msub></math> 的定义。</p>
        <p><math alttext="x^2 + y^2"><mi>x</mi></math></p>
        <math display="block"><semantics><mrow><mi>E</mi></mrow>
          <annotation encoding="application/x-tex">E=mc^2</annotation></semantics></math>
        <p>无源码 <math><mi>a</mi><mo>+</mo><mn>1</mn></math> 用文字</p>
        <p><m:math xmlns:m="http://www.w3.org/1998/Math/MathML" alttext="\\frac{a}{b}"><m:mi>a</m:mi></m:math>，(2.1)</p>
        <p>前文<math display="block" alttext="y=x"><mi>y</mi></math>后文</p>`),
    );
    expect(brief(doc)).toEqual([
      'p 收益 $r_t$ 的定义。',
      'eq x^2 + y^2',
      'eq E=mc^2',
      'p 无源码 $a+1$ 用文字',
      'eq \\frac{a}{b} \\tag{2.1}',
      'p 前文',
      'eq y=x',
      'p 后文',
    ]);
  });

  it('pre 保留换行和缩进', async () => {
    const doc = await parse(
      simpleBook(`<pre><code>
def mom(px):
    return px[-1] / px[-21] - 1</code></pre><pre>a<br/>b</pre>`),
    );
    expect(blocksOf(doc, 'code').map(b => b.text)).toEqual([
      'def mom(px):\n    return px[-1] / px[-21] - 1',
      'a\nb',
    ]);
  });

  it('引文的段落、div 里散落的文字、<br> 换行；跳过 nav / script / 分页标记 / 脚注', async () => {
    const doc = await parse(
      simpleBook(`
        <div>散落的
          文字<p>段落</p>后面的字</div>
        <blockquote><p>引文一</p><p>引文二</p></blockquote>
        <p>第一行<br/>   第二行   </p>
        <p>前<span epub:type="pagebreak" id="pg12">12</span>后</p>
        <nav><p>导航</p></nav><script>x()</script>
        <aside epub:type="footnote"><p>脚注</p></aside>
        <p>  </p><p>&nbsp;</p>`),
    );
    expect(brief(doc)).toEqual([
      'p 散落的 文字',
      'p 段落',
      'p 后面的字',
      'p 引文一',
      'p 引文二',
      'p 第一行\n第二行',
      'p 前后',
    ]);
  });
});

describe('警告和错误', () => {
  it('缺图：提示，有 alt 的留下文字，没有文字的图块不要', async () => {
    const doc = await parse(
      simpleBook(
        '<p><img src="../images/gone.png" alt="缺的图"/></p><img src="../images/gone2.png"/><p>正文</p>',
      ),
    );
    expect(doc.items).toEqual([
      { kind: 'block', type: 'img', text: '缺的图' },
      { kind: 'block', type: 'p', text: '正文' },
    ]);
    expect(doc.warnings).toEqual([
      '缺图：OEBPS/images/gone.png',
      '缺图：OEBPS/images/gone2.png',
    ]);
  });

  it('读不出来的正文文件跳过并提示，其余照常', async () => {
    const files = navBook('<nav epub:type="toc"><ol></ol></nav>', {
      a: '<p>能读</p>',
      b: '<p>读不出</p>',
    });
    delete (files as Record<string, string>)['OEBPS/text/b.xhtml'];
    const doc = await parse(files);
    expect(brief(doc)).toEqual(['p 能读']);
    expect(doc.warnings).toEqual([
      '正文文件读不出来，已跳过：OEBPS/text/b.xhtml',
    ]);
  });

  it('坏 EPUB → EpubError', async () => {
    const good: Record<string, string> = simpleBook('<p>x</p>');
    const code = (files: Record<string, string>) =>
      parse(files).then(
        () => 'ok',
        (e: unknown) => (e instanceof EpubError ? e.code : String(e)),
      );
    const without = (key: string) => {
      const copy = { ...good };
      delete copy[key];
      return copy;
    };
    expect(await code(without('META-INF/container.xml'))).toBe(
      'invalid_archive',
    );
    expect(
      await code({ ...good, 'META-INF/container.xml': '<container/>' }),
    ).toBe('invalid_archive');
    expect(
      await code({
        ...good,
        'META-INF/container.xml': container('OEBPS/x.opf'),
      }),
    ).toBe('invalid_archive');
    expect(
      await code({
        ...good,
        'OEBPS/content.opf': '<package><manifest/></package>',
      }),
    ).toBe('invalid_metadata');
    expect(
      await code({
        ...good,
        'OEBPS/content.opf': opf({
          items: item('c1', 'text/c1.xhtml'),
          spine: '',
        }),
      }),
    ).toBe('invalid_metadata');
    expect(await code(without('OEBPS/text/c1.xhtml'))).toBe('unreadable_spine');
    expect(await code(simpleBook('<p> </p>'))).toBe('unreadable_spine');
  });
});
