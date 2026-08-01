/**
 * Just enough dense linear algebra for a few dozen unknowns.
 *
 * Two tools, chosen for two different jobs. A one-sided Jacobi SVD answers
 * "what is the rank of this matrix, really" — slow, but it runs a handful of
 * times when a mechanism is built and never inside the animation loop. An LU
 * solve with partial pivoting handles everything on the hot path, where the
 * matrices are square, well conditioned and solved sixty times a second.
 */

/** Column pairs stop rotating once they are orthogonal to this relative accuracy. */
const JACOBI_EPS = 1e-15;
const JACOBI_SWEEPS = 48;

export interface Svd {
  /** Padded row count, max(m, n): a wide matrix is squared up with zero rows. */
  rows: number;
  cols: number;
  /** Singular values, descending. */
  sigma: Float64Array;
  /** Right singular vectors, column-major: column j is vⱼ. */
  v: Float64Array;
  /** Column-major, column j is σⱼuⱼ — the input with its columns rotated apart. */
  w: Float64Array;
}

/**
 * Singular value decomposition of a row-major m×n matrix, by one-sided Jacobi:
 * rotate pairs of columns until they are mutually orthogonal. What is left has
 * the singular values as its column norms, and the accumulated rotations are V.
 *
 * Wide matrices (m < n) are padded with zero rows, which changes neither the
 * singular values nor V — and wide is the normal case here, since a one-degree
 * -of-freedom constraint Jacobian is one row short of square.
 */
export function svd(a: Float64Array, m: number, n: number): Svd {
  const rows = Math.max(m, n);
  const w = new Float64Array(rows * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < m; i++) w[j * rows + i] = a[i * n + j];
  }
  const v = new Float64Array(n * n);
  for (let j = 0; j < n; j++) v[j * n + j] = 1;

  for (let sweep = 0; sweep < JACOBI_SWEEPS; sweep++) {
    let rotated = false;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const cp = p * rows;
        const cq = q * rows;
        let alpha = 0;
        let beta = 0;
        let gamma = 0;
        for (let i = 0; i < rows; i++) {
          const x = w[cp + i];
          const y = w[cq + i];
          alpha += x * x;
          beta += y * y;
          gamma += x * y;
        }
        if (Math.abs(gamma) <= JACOBI_EPS * Math.sqrt(alpha * beta)) continue;

        // The rotation that kills the inner product of these two columns.
        const zeta = (beta - alpha) / (2 * gamma);
        const t =
          (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        rotated = true;

        for (let i = 0; i < rows; i++) {
          const x = w[cp + i];
          const y = w[cq + i];
          w[cp + i] = c * x - s * y;
          w[cq + i] = s * x + c * y;
        }
        const vp = p * n;
        const vq = q * n;
        for (let i = 0; i < n; i++) {
          const x = v[vp + i];
          const y = v[vq + i];
          v[vp + i] = c * x - s * y;
          v[vq + i] = s * x + c * y;
        }
      }
    }
    if (!rotated) break;
  }

  const sigma = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let sum = 0;
    for (let i = 0; i < rows; i++) sum += w[j * rows + i] * w[j * rows + i];
    sigma[j] = Math.sqrt(sum);
  }

  const order = Array.from({ length: n }, (_, j) => j).sort((x, y) => sigma[y] - sigma[x]);
  const sortedSigma = new Float64Array(n);
  const sortedV = new Float64Array(n * n);
  const sortedW = new Float64Array(rows * n);
  for (let j = 0; j < n; j++) {
    const from = order[j];
    sortedSigma[j] = sigma[from];
    sortedV.set(v.subarray(from * n, from * n + n), j * n);
    sortedW.set(w.subarray(from * rows, from * rows + rows), j * rows);
  }

  return { rows, cols: n, sigma: sortedSigma, v: sortedV, w: sortedW };
}

/** Number of singular values above a relative tolerance. */
export function rankOf(s: Svd, rel = 1e-9): number {
  const top = s.sigma[0];
  if (!(top > 0)) return 0;
  let r = 0;
  for (let j = 0; j < s.cols; j++) if (s.sigma[j] > rel * top) r++;
  return r;
}

/**
 * LU factorisation with partial pivoting, in place on a row-major n×n matrix.
 * Returns the ratio of the smallest pivot to the largest — a cheap standin for
 * a condition number, and zero when the matrix is exactly singular.
 */
export function luFactor(a: Float64Array, n: number, piv: Int32Array): number {
  for (let i = 0; i < n; i++) piv[i] = i;
  let smallest = Infinity;
  let largest = 0;

  for (let k = 0; k < n; k++) {
    let best = k;
    let bestAbs = Math.abs(a[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const abs = Math.abs(a[i * n + k]);
      if (abs > bestAbs) {
        best = i;
        bestAbs = abs;
      }
    }
    if (best !== k) {
      for (let j = 0; j < n; j++) {
        const tmp = a[k * n + j];
        a[k * n + j] = a[best * n + j];
        a[best * n + j] = tmp;
      }
      const t = piv[k];
      piv[k] = piv[best];
      piv[best] = t;
    }

    const pivot = a[k * n + k];
    if (pivot === 0) return 0;
    if (bestAbs < smallest) smallest = bestAbs;
    if (bestAbs > largest) largest = bestAbs;

    for (let i = k + 1; i < n; i++) {
      const f = a[i * n + k] / pivot;
      a[i * n + k] = f;
      if (f === 0) continue;
      for (let j = k + 1; j < n; j++) a[i * n + j] -= f * a[k * n + j];
    }
  }
  return largest > 0 ? smallest / largest : 0;
}

/** Solve for x in place, given the factorisation `luFactor` left behind. */
export function luSolve(
  a: Float64Array,
  n: number,
  piv: Int32Array,
  b: Float64Array,
  x: Float64Array,
): void {
  for (let i = 0; i < n; i++) x[i] = b[piv[i]];
  for (let i = 1; i < n; i++) {
    let sum = x[i];
    for (let j = 0; j < i; j++) sum -= a[i * n + j] * x[j];
    x[i] = sum;
  }
  for (let i = n - 1; i >= 0; i--) {
    let sum = x[i];
    for (let j = i + 1; j < n; j++) sum -= a[i * n + j] * x[j];
    x[i] = sum / a[i * n + i];
  }
}

/**
 * Orthonormal basis of a growing row space, kept by modified Gram-Schmidt.
 * Adding a row tells you whether it was independent of everything already in —
 * which is the rank test the pin filter needs, one row at a time, without
 * refactoring the whole matrix for every proposal.
 */
export interface RowSpace {
  n: number;
  rows: Float64Array[];
}

export const rowSpace = (n: number): RowSpace => ({ n, rows: [] });

/**
 * Try to add `row` to the basis. Returns true if it was independent — and only
 * then is the basis changed, so a rejected proposal leaves no trace.
 */
export function addRow(space: RowSpace, row: Float64Array, rel = 1e-8): boolean {
  const work = Float64Array.from(row);
  let norm0 = 0;
  for (let i = 0; i < space.n; i++) norm0 += work[i] * work[i];
  norm0 = Math.sqrt(norm0);
  if (norm0 === 0) return false;

  // Twice is enough: one pass loses orthogonality when the row is nearly
  // dependent, which is exactly the case being measured.
  for (let pass = 0; pass < 2; pass++) {
    for (const basis of space.rows) {
      let dot = 0;
      for (let i = 0; i < space.n; i++) dot += basis[i] * work[i];
      for (let i = 0; i < space.n; i++) work[i] -= dot * basis[i];
    }
  }

  let norm = 0;
  for (let i = 0; i < space.n; i++) norm += work[i] * work[i];
  norm = Math.sqrt(norm);
  if (norm <= rel * norm0) return false;

  for (let i = 0; i < space.n; i++) work[i] /= norm;
  space.rows.push(work);
  return true;
}
