/**
 * Standard Gaussian elimination with partial pivoting to solve Ax = b
 * n = 8 system equations for homography
 */
export function solveGaussian(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    M[i] = [...A[i], b[i]];
  }

  for (let i = 0; i < n; i++) {
    // Partial pivoting: find maximum pivot in column i
    let maxEl = Math.abs(M[i][i]);
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > maxEl) {
        maxEl = Math.abs(M[k][i]);
        maxRow = k;
      }
    }

    // Swap row with max element
    const temp = M[maxRow];
    M[maxRow] = M[i];
    M[i] = temp;

    // Numerical stability check
    if (Math.abs(M[i][i]) < 1e-10) {
      // Avoid division by zero: matrix is singular or near-singular
      continue;
    }

    // Row operations to make bottom elements 0
    for (let k = i + 1; k < n; k++) {
      const c = -M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) {
        if (i === j) {
          M[k][j] = 0;
        } else {
          M[k][j] += c * M[i][j];
        }
      }
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n] / M[i][i];
    for (let k = i - 1; k >= 0; k--) {
      M[k][n] -= M[k][i] * x[i];
    }
  }
  return x;
}

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Computes a 3x3 homography matrix H mapping from src points to dst points
 * where H[8] (h22) is normalized to 1.
 * @param src Array of 4 Point2D representing source corners
 * @param dst Array of 4 Point2D representing destination corners
 * @returns 9-element array representing the 3x3 matrix in row-major order:
 *          [h00, h01, h02, h10, h11, h12, h20, h21, 1]
 */
export function getHomographyMatrix(src: Point2D[], dst: Point2D[]): number[] {
  if (src.length !== 4 || dst.length !== 4) {
    throw new Error("Homography requires exactly 4 source and 4 destination points");
  }

  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];

    // u equation
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);

    // v equation
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }

  try {
    const h = solveGaussian(A, b);
    return [
      h[0], h[1], h[2],
      h[3], h[4], h[5],
      h[6], h[7], 1.0
    ];
  } catch (err) {
    console.error("Gaussian elimination failed for homography computation:", err);
    // Return identity fallback
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
}

/**
 * Transforms a point (x, y) using homography matrix H
 */
export function transformPoint(x: number, y: number, H: number[]): Point2D {
  const w = H[6] * x + H[7] * y + H[8];
  
  // Guard against divide by zero or negative perspective plane crossing
  if (Math.abs(w) < 1e-5) {
    return {
      x: H[0] * x + H[1] * y + H[2],
      y: H[3] * x + H[4] * y + H[5]
    };
  }

  return {
    x: (H[0] * x + H[1] * y + H[2]) / w,
    y: (H[3] * x + H[4] * y + H[5]) / w
  };
}

/**
 * Converts a 3x3 homography matrix into a column-major 3D CSS transform string: matrix3d(...)
 */
export function getCssMatrix3d(H: number[]): string {
  // CSS matrix3d parameters in column-major order:
  // [
  //   H00, H10, 0, H20,
  //   H01, H11, 0, H21,
  //   0,   0,   1, 0,
  //   H02, H12, 0, 1
  // ]
  return `matrix3d(
    ${H[0].toFixed(6)}, ${H[3].toFixed(6)}, 0, ${H[6].toFixed(6)},
    ${H[1].toFixed(6)}, ${H[4].toFixed(6)}, 0, ${H[7].toFixed(6)},
    0, 0, 1, 0,
    ${H[2].toFixed(6)}, ${H[5].toFixed(6)}, 0, 1
  )`;
}
