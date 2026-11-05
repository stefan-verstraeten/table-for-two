"""Our Michelin-style star.

Geometry: six teardrop-shaped holes (each the convex hull of the centre point
and a circle), surrounded by a band of width T. Neighbouring bands merge into
the solid flaring spokes, and a central disc is cut out. Filled, not stroked.

    python3 tools/star.py          -> prints the SVG path (viewBox 0 0 100 100)
    python3 tools/star.py preview  -> writes .test/star_preview.png
"""
import math, sys

R = 50.0          # outer radius
T = 5.4           # band thickness
BETA = 23.0       # half-angle of each teardrop at the centre (degrees)
R0 = 15.0         # radius of the central cut
CX = CY = 50.0

b = math.radians(BETA)
D = (R - T) / (1 + math.sin(b))     # distance from centre to each teardrop's round end
RC = D * math.sin(b)                # radius of the round end
T_LEN = D * math.cos(b)             # length of the straight sides


def sd_hole(u, v):
    """Signed distance to a teardrop with apex at the origin pointing along +u."""
    v = abs(v)
    proj = u * math.cos(b) + v * math.sin(b)
    if proj < 0:
        return math.hypot(u, v)
    if proj > T_LEN:
        return math.hypot(u - D, v) - RC
    return -u * math.sin(b) + v * math.cos(b)


def polar(r, deg):
    a = math.radians(deg)
    return (CX + r * math.sin(a), CY - r * math.cos(a))


def fmt(p):
    return f"{p[0]:.2f} {p[1]:.2f}"


def notch_radius():
    """Outermost point on the bisector between petals 0 and 1 still inside the band."""
    lo, hi = 0.0, R
    for _ in range(60):
        mid = (lo + hi) / 2
        a = math.radians(30)
        u, v = mid * math.cos(a), mid * math.sin(a)      # petal-0 frame
        lo, hi = (mid, hi) if sd_hole(u, v) <= T else (lo, mid)
    return lo


def svg_path():
    sN = notch_radius()
    a = math.radians(30)
    on_line = (sN * math.cos(a) * math.cos(b) + sN * math.sin(a) * math.sin(b)) <= T_LEN
    out = []
    for k in range(6):
        ang = k * 60
        cxk, cyk = polar(D, ang)
        if k == 0:
            out.append("M" + fmt(polar(sN, ang - 30)))
        end = polar(sN, ang + 30)
        if on_line:
            q1 = polar_from((cxk, cyk), RC + T, ang - 90 - BETA)
            q2 = polar_from((cxk, cyk), RC + T, ang + 90 + BETA)
            out.append(f"L{fmt(q1)}A{RC + T:.2f} {RC + T:.2f} 0 1 1 {fmt(q2)}L{fmt(end)}")
        else:
            # The arc passes over the tip; it spans more than 180 degrees when the
            # notch lies closer to the centre than the round end's centre.
            large = 1 if sN * math.cos(a) < D else 0
            out.append(f"A{RC + T:.2f} {RC + T:.2f} 0 {large} 1 {fmt(end)}")
    out.append("Z")
    for k in range(6):
        ang = k * 60
        out.append(("M" if k == 0 else "L") + fmt(polar(R0, ang - BETA)))
        out.append(f"L{fmt(polar(T_LEN, ang - BETA))}A{RC:.2f} {RC:.2f} 0 1 1 "
                   f"{fmt(polar(T_LEN, ang + BETA))}L{fmt(polar(R0, ang + BETA))}")
    out.append("Z")
    return "".join(out)


def polar_from(c, r, deg):
    a = math.radians(deg)
    return (c[0] + r * math.sin(a), c[1] - r * math.cos(a))


def mask(W, H, cx, cy, scale, rotate=0.0):
    """Boolean numpy mask of the star centred at (cx,cy) px, `scale` px per unit."""
    import numpy as np
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
    x = (xs - cx) / scale
    y = (ys - cy) / scale
    r = np.hypot(x, y)
    dmin = np.full(x.shape, 1e9)
    inhole = np.zeros(x.shape, bool)
    sb, cb = math.sin(b), math.cos(b)
    for k in range(6):
        a = math.radians(k * 60 + rotate)
        ax, ay = math.sin(a), -math.cos(a)
        u = x * ax + y * ay
        v = np.abs(x * (-ay) + y * ax)
        proj = u * cb + v * sb
        d = np.where(proj < 0, np.hypot(u, v),
                     np.where(proj > T_LEN, np.hypot(u - D, v) - RC, -u * sb + v * cb))
        dmin = np.minimum(dmin, d)
        inhole |= d < 0
    return (dmin <= T) & (~inhole) & (r >= R0)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "preview":
        import numpy as np
        from PIL import Image
        S = 1600
        arr = np.full((S, S, 3), (243, 239, 231), np.uint8)
        arr[mask(S, S, S / 2, S / 2, S / 100)] = (189, 31, 45)
        Image.fromarray(arr).resize((500, 500), Image.LANCZOS).save(".test/star_preview.png")
        print("notch radius", round(notch_radius(), 2), "D", round(D, 2), "RC", round(RC, 2))
    else:
        print(svg_path())
