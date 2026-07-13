# models.py

def yallop_q(arcv_deg, width_arcmin):
    """Yallop q criterion using ARCV and topocentric crescent width W."""
    w = max(float(width_arcmin), 0.0)
    threshold_arcv = 11.8371 - (6.3226 * w) + (0.7319 * w ** 2) - (0.1018 * w ** 3)
    return (float(arcv_deg) - threshold_arcv) / 10.3741


def yallop_model(arcv_deg, width_arcmin):
    q = yallop_q(arcv_deg, width_arcmin)
    if q > 0.216:
        return (6, "A: Easily visible")
    if q > -0.014:
        return (5, "B: Visible under perfect conditions")
    if q > -0.160:
        return (4, "C: May need optical aid")
    if q > -0.232:
        return (3, "D: Will need optical aid")
    if q > -0.293:
        return (2, "E: Not visible with telescope")
    if q > -0.490:
        return (1, "F: Only photographic")
    return (0, "G: Not visible")


def odeh_v(arcv_deg, width_arcmin):
    """Odeh visibility criterion using ARCV and crescent width W."""
    w = max(float(width_arcmin), 0.0)
    threshold_arcv = -0.1018 * w ** 3 + 0.7319 * w ** 2 - 6.3226 * w + 7.1651
    return float(arcv_deg) - threshold_arcv


def odeh_model(arcv_deg, width_arcmin):
    v = odeh_v(arcv_deg, width_arcmin)
    if v >= 5.65:
        return (3, "A: Easily visible by naked eye")
    if v >= 2.00:
        return (2, "B: Visible by optical aid, may be naked-eye")
    if v >= -0.96:
        return (1, "C: Visible only with optical aid")
    return (0, "D: Not visible")


def ilyas_model(moon_alt, elongation):
    if moon_alt > 10 and elongation > 11:
        return (2, "Legacy heuristic: Visible")
    if moon_alt > 5 and elongation > 8:
        return (1, "Legacy heuristic: Marginal")
    return (0, "Legacy heuristic: Not Visible")


def shaukat_model(elongation, moon_alt, moon_age):
    if moon_alt > 10 and elongation > 12 and moon_age > 20:
        return (2, "Legacy heuristic: Visible")
    if moon_alt > 6 and elongation > 9 and moon_age > 16:
        return (1, "Legacy heuristic: Marginal")
    return (0, "Legacy heuristic: Not Visible")


def saao_model(moon_age, lag_time):
    if moon_age > 20 and lag_time > 40:
        return (2, "Legacy heuristic: Visible")
    if moon_age > 15 and lag_time > 30:
        return (1, "Legacy heuristic: Marginal")
    return (0, "Legacy heuristic: Not Visible")


def yallop_details(arcv_deg, width_arcmin):
    return {
        "yallop_q": yallop_q(arcv_deg, width_arcmin),
        "yallop_arcv_deg": float(arcv_deg),
        "yallop_w_arcmin": float(width_arcmin),
    }


def odeh_details(arcv_deg, width_arcmin):
    return {
        "odeh_v": odeh_v(arcv_deg, width_arcmin),
        "odeh_arcv_deg": float(arcv_deg),
        "odeh_w_arcmin": float(width_arcmin),
    }
