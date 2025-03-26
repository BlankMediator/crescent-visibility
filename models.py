models.py

def ilyas_model(moon_alt, elongation):
    if moon_alt > 10 and elongation > 11:
        return (2, "Visible")
    elif moon_alt > 5 and elongation > 8:
        return (1, "Marginal")
    return (0, "Not Visible")

def yallop_model(arc_v, diff_alt):
    if arc_v > 14.8 and diff_alt > 4.1:
        return (6, "A: Easily visible")
    elif arc_v > 12.1:
        return (5, "B: Visible under perfect conditions")
    elif arc_v > 10.5:
        return (4, "C: May need optical aid")
    elif arc_v > 9.5:
        return (3, "D: Will need optical aid")
    elif arc_v > 8.4:
        return (2, "E: Visible with telescope")
    elif arc_v > 7.0:
        return (1, "F: Only photographic")
    else:
        return (0, "G: Not visible")

def odeh_model(elongation, moon_age):
    if elongation < 8 or moon_age < 15:
        return (0, "Not Visible")
    elif elongation > 10 and moon_age > 20:
        return (2, "Easily Visible")
    return (1, "Possibly Visible")

def shaukat_model(elongation, moon_alt, moon_age):
    if moon_alt > 10 and elongation > 12 and moon_age > 20:
        return (2, "Visible")
    elif moon_alt > 6 and elongation > 9 and moon_age > 16:
        return (1, "Marginal")
    return (0, "Not Visible")

def saao_model(moon_age, lag_time):
    if moon_age > 20 and lag_time > 40:
        return (2, "Visible")
    elif moon_age > 15 and lag_time > 30:
        return (1, "Marginal")
    return (0, "Not Visible")