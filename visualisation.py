visualisation.py

import matplotlib.pyplot as plt
import os
import numpy as np

def encode_visibility(result):
    mapping = {
        "Not Visible": 0,
        "Marginal": 1,
        "Possibly Visible": 2,
        "Visible": 3,
        "Easily Visible": 4,
        "A: Easily Visible": 4,
        "B: Visible under perfect conditions": 3,
        "C: May need optical aid": 2,
        "D: Optical aid essential": 1,
        "E: Not visible (optical only)": 0,
        "F: Not visible": 0,
        "G: Impossible": 0,
        "N/A": np.nan
    }
    return mapping.get(result, np.nan)

def plot_model_results(model_outputs, overlay_models=None):
    os.makedirs("data", exist_ok=True)
    legend_lines = []

    for model, results_by_date in model_outputs.items():
        times = []
        values = []
        all_labels = []
        for date, entries in results_by_date.items():
            for dt, label in entries:
                times.append(dt)
                values.append(encode_visibility(label))
                all_labels.append(label)
            times.append(np.nan)
            values.append(np.nan)

        if not overlay_models or model in overlay_models:
            plt.figure()
            plt.plot(times, values, marker='o')
            plt.title(f"{model.title()} Visibility Over Time")
            plt.xlabel("UTC")
            plt.ylabel("Visibility (encoded)")
            plt.grid(True)
            plt.gcf().autofmt_xdate()
            plt.tight_layout()
            out_path = f"data/visibility_{model}.png"
            plt.savefig(out_path)
            plt.close()

        legend_lines.append(f"{model}: {set(all_labels)}")

    if overlay_models:
        plt.figure()
        for model in overlay_models:
            if model not in model_outputs:
                continue
            combined_times = []
            combined_values = []
            for date, entries in model_outputs[model].items():
                for dt, label in entries:
                    combined_times.append(dt)
                    combined_values.append(encode_visibility(label))
                combined_times.append(np.nan)
                combined_values.append(np.nan)
            plt.plot(combined_times, combined_values, marker='o', label=model)

        plt.title("Overlayed Model Visibility")
        plt.xlabel("UTC Time")
        plt.ylabel("Visibility (encoded)")
        plt.grid(True)
        plt.gcf().autofmt_xdate()
        plt.tight_layout()
        plt.legend()
        plt.savefig("data/visibility_overlay.png")
        plt.close()

    with open("data/model_legend.txt", "w") as f:
        f.write("\n".join(legend_lines))