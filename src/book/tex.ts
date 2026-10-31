/**
 * 行内公式 → 文字（QUANTWISE_DESIGN.md §9）：把简单的 TeX 换成 Unicode（rₜ、√252、σ、×），
 * 放进普通 Text 里和正文一起排。转不了（分式套分式、矩阵）的返回 null，界面显示原文。
 */

const SYM: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ',
  phi: 'φ', varphi: 'φ', omega: 'ω', ell: 'ℓ', Delta: 'Δ', Sigma: 'Σ', Phi: 'Φ',
  Omega: 'Ω', Gamma: 'Γ', Pi: 'Π',
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
  const src = tex.trim();
  const skipSpace = () => {
    while (src[i] === ' ') {
      i++;
    }
  };
  const group = (): string => {
    skipSpace();
    if (src[i] === '{') {
      i++;
      const out = seq('}');
      if (src[i] !== '}') {
        throw new Unsupported();
      }
      i++;
      return out;
    }
    return atom();
  };
  const atom = (): string => {
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
      if (['mathrm', 'text', 'operatorname', 'mathbf', 'mathit', 'boldsymbol'].includes(name)) {
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
      return SYM[name] ?? name;
    }
    i++;
    if (c === '_') {
      return script(group(), SUB, '_');
    }
    if (c === '^') {
      return script(group(), SUP, '^');
    }
    if (c === '{') {
      const out = seq('}');
      i++;
      return out;
    }
    if (c === '-') {
      return '−';
    }
    if (c === '=' || c === '+' || c === '<' || c === '>') {
      return ' ' + c + ' ';
    }
    if (c === ' ') {
      // 保留原文里的空格（a \times b → a × b，P_{t-1} 照样紧挨着），最后再合并连续空格
      return ' ';
    }
    return c;
  };
  function seq(end?: string): string {
    let out = '';
    while (i < src.length && src[i] !== end) {
      out += atom();
    }
    return out;
  }
  try {
    return seq().replace(/\s{2,}/g, ' ').trim();
  } catch {
    return null;
  }
}
