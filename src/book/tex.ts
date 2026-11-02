/**
 * 行内公式 → 文字（QUANTWISE_DESIGN.md §9）：把简单的 TeX 换成 Unicode（rₜ、√252、σ、×），
 * 放进普通 Text 里和正文一起排。转不了（分式套分式、矩阵）的返回 null，界面显示原文。
 * 和 TeX 一样不管原文的空格（MinerU 在每个记号之间都加空格：0 . 8 \times 1 2），运算符两边的空格由这里加。
 */

const SYM: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ',
  phi: 'φ', varphi: 'φ', omega: 'ω', ell: 'ℓ', Delta: 'Δ', Sigma: 'Σ', Phi: 'Φ',
  Omega: 'Ω', Gamma: 'Γ', Pi: 'Π', Lambda: 'Λ', xi: 'ξ', Xi: 'Ξ', eta: 'η', zeta: 'ζ', nu: 'ν', psi: 'ψ', Psi: 'Ψ', chi: 'χ',
  times: '×', cdot: '·', approx: '≈', neq: '≠', ne: '≠', le: '≤', leq: '≤',
  ge: '≥', geq: '≥', pm: '±', mp: '∓', infty: '∞', sum: '∑', prod: '∏',
  partial: '∂', nabla: '∇', in: '∈', to: '→', rightarrow: '→', leftarrow: '←',
  Rightarrow: '⇒', sim: '∼', propto: '∝', dots: '…', ldots: '…', cdots: '⋯',
  ln: 'ln', log: 'log', exp: 'exp', max: 'max', min: 'min', corr: 'corr',
  cov: 'cov', var: 'var', median: 'median', E: 'E',
};
const SUB: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇',
  '8': '₈', '9': '₉', '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ',
  e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ',
  p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ', ',': ',', ' ': '',
};
const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷',
  '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ',
  i: 'ⁱ', T: 'ᵀ', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', k: 'ᵏ', m: 'ᵐ',
  t: 'ᵗ', x: 'ˣ', y: 'ʸ', ' ': '',
};

/** 两边加空格的运算符和关系符：a × b、IR ≈ IC × √BR。 */
const BIN = new Set([
  'times', 'cdot', 'approx', 'neq', 'ne', 'le', 'leq', 'ge', 'geq', 'pm', 'mp',
  'in', 'to', 'rightarrow', 'leftarrow', 'Rightarrow', 'sim', 'propto',
]);
/** 函数名后面跟字母或数字时空一格：ln Pₜ，corr(…) 不空。 */
const OPS = new Set(['ln', 'log', 'exp', 'max', 'min', 'corr', 'cov', 'var', 'median']);

/** 前面是空的或者是运算符、左括号：这里的 − / + 是正负号，不加空格。 */
const unary = (prev: string) => {
  const t = prev.trimEnd();
  return !t || /[([{=+−×·≈≠≤≥<>±,→∈]$/.test(t);
};

class Unsupported extends Error {}

/** 分子、分母、根号里有运算符时加括号：Pₜ/Pₜ₋₁ 不加，(n − 1) 加。 */
const wrap = (x: string) => (/[ +−=/×·]/.test(x.trim()) ? '(' + x.trim() + ')' : x);

/** 下标 / 上标：每个字都有对应的 Unicode 才转，否则用 _(…) / ^(…) 写出来。 */
function script(s: string, map: Record<string, string>, mark: string): string {
  const chars = [...s];
  if (chars.every(c => map[c] != null)) {
    return chars.map(c => map[c]).join('');
  }
  return mark + (chars.length > 1 ? '(' + s + ')' : s);
}

export function texToText(tex: string): string | null {
  let i = 0;
  let depth = 0;
  let inText = false;
  const src = tex.trim();
  const skipSpace = () => {
    while (/\s/.test(src[i] ?? '')) {
      i++;
    }
  };
  const group = (): string => {
    skipSpace();
    if (src[i] === '{') {
      i++;
      depth++;
      const out = seq('}');
      depth--;
      if (src[i] !== '}') {
        throw new Unsupported();
      }
      i++;
      return out;
    }
    return atom('');
  };
  /** 函数名后面：下一个记号是字母、数字或别的命令（\left 除外）就空一格。 */
  const opGap = () => {
    skipSpace();
    const rest = src.slice(i);
    return /^[A-Za-z0-9{]/.test(rest) || (/^\\[a-zA-Z]/.test(rest) && !/^\\(left|right)(?![a-zA-Z])/.test(rest)) ? ' ' : '';
  };
  const atom = (prev: string): string => {
    const c = src[i];
    if (c == null) {
      throw new Unsupported();
    }
    if (c === '\\') {
      i++;
      let name = '';
      while (i < src.length && /[a-zA-Z]/.test(src[i])) {
        name += src[i++];
      }
      if (!name) {
        const ch = src[i++];
        return ',;: '.includes(ch) ? ' ' : ch === '!' ? '' : ch;
      }
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const a = group();
        const b = group();
        return wrap(a) + '/' + wrap(b);
      }
      if (name === 'sqrt') {
        return '√' + wrap(group());
      }
      if (name === 'bar' || name === 'overline') {
        return group() + '̄';
      }
      if (name === 'hat') {
        return group() + '̂';
      }
      if (name === 'tilde') {
        return group() + '̃';
      }
      if (['text', 'textrm', 'textit', 'textbf', 'mbox'].includes(name)) {
        const was = inText;
        inText = true;
        const out = group();
        inText = was;
        return out;
      }
      if (name === 'operatorname') {
        return group() + opGap();
      }
      if (['mathrm', 'mathbf', 'mathit', 'boldsymbol'].includes(name)) {
        return group();
      }
      if (name === 'left' || name === 'right') {
        skipSpace();
        const d = src[i++];
        return d === '.' ? '' : d === '\\' ? src[i++] : d;
      }
      if (name === 'quad' || name === 'qquad') {
        return ' ';
      }
      if (['begin', 'end', 'matrix', 'array', 'cases'].includes(name)) {
        throw new Unsupported();
      }
      if (BIN.has(name)) {
        return ' ' + SYM[name] + ' ';
      }
      if (OPS.has(name)) {
        return SYM[name] + opGap();
      }
      // 不认识的命令不能悄悄丢掉反斜杠，变成另一个变量。
      if (SYM[name] == null) throw new Unsupported();
      return SYM[name];
    }
    i++;
    if (c === '_') {
      return script(group(), SUB, '_');
    }
    if (c === '^') {
      return script(group(), SUP, '^');
    }
    if (c === '{') {
      depth++;
      const out = seq('}');
      depth--;
      i++;
      return out;
    }
    if (/\s/.test(c)) {
      return inText ? ' ' : '';
    }
    // 括号里（下标、分子分母）紧凑写：Pₜ₋₁、(n−1)；外面的加减号两边空格，正负号不空
    if (c === '-' || c === '+') {
      const sign = c === '-' ? '−' : '+';
      return depth === 0 && !unary(prev) ? ' ' + sign + ' ' : sign;
    }
    if (c === '=' || c === '<' || c === '>') {
      return ' ' + c + ' ';
    }
    if (c === ',') {
      return depth === 0 ? ', ' : ',';
    }
    return c;
  };
  function seq(end?: string): string {
    let out = '';
    while (i < src.length && src[i] !== end) {
      out += atom(out);
    }
    return out;
  }
  try {
    return seq().replace(/\s{2,}/g, ' ').trim();
  } catch {
    return null;
  }
}
