"""
evaluate.py — Model evaluation script for Jaw Crusher Monitor
Kannan Blue Metals

Run this on the Pi (or any machine with the dataset and weights):

    python evaluate.py --data /path/to/dataset --weights weights/best.pt

Dataset folder must follow standard YOLO classification layout:
    dataset/
        test/
            jaw filled/
                img1.jpg ...
            jaw partially filled/
                img1.jpg ...
            jaw empty/
                img1.jpg ...

Outputs:
  - Per-class precision, recall, F1
  - Overall accuracy
  - Confusion matrix (printed + saved as confusion_matrix.png)
  - Full report saved to model_eval/eval_results.txt
"""

import argparse
import sys
from pathlib import Path

import numpy as np


def run_eval(data_dir: str, weights: str, conf: float, img_size: int):
    try:
        from ultralytics import YOLO
    except ImportError:
        print("ERROR: ultralytics not installed. Run: pip install ultralytics")
        sys.exit(1)

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from matplotlib.colors import LinearSegmentedColormap
        HAS_MPL = True
    except ImportError:
        HAS_MPL = False
        print("WARNING: matplotlib not installed — confusion matrix image will be skipped.")

    data_path = Path(data_dir)
    test_path = data_path / "test"
    if not test_path.exists():
        # Try without test/ subfolder
        test_path = data_path
        if not any(test_path.iterdir()):
            print(f"ERROR: No test images found at {test_path}")
            sys.exit(1)

    # ── Discover classes ──────────────────────────────────────────────────
    class_dirs = sorted([d for d in test_path.iterdir() if d.is_dir()])
    if not class_dirs:
        print(f"ERROR: No class subdirectories found in {test_path}")
        sys.exit(1)

    classes    = [d.name for d in class_dirs]
    n_classes  = len(classes)
    print(f"\nClasses found: {classes}")

    # ── Load model ────────────────────────────────────────────────────────
    print(f"Loading model: {weights}")
    model = YOLO(weights)

    # ── Run inference on each image ───────────────────────────────────────
    y_true = []
    y_pred = []
    total  = 0
    errors = 0

    for class_idx, class_dir in enumerate(class_dirs):
        images = list(class_dir.glob("*.jpg")) + \
                 list(class_dir.glob("*.jpeg")) + \
                 list(class_dir.glob("*.png"))

        print(f"  [{class_dir.name}] {len(images)} images")

        for img_path in images:
            try:
                results = model(str(img_path), conf=conf, imgsz=img_size, verbose=False)
                result  = results[0]
                if result.probs is None:
                    errors += 1
                    continue
                pred_idx = int(result.probs.top1)
                # Map model class name back to our class index
                pred_name = result.names[pred_idx].lower().replace("_", " ")
                pred_class_idx = next(
                    (i for i, c in enumerate(classes) if c.lower() == pred_name),
                    pred_idx if pred_idx < n_classes else 0
                )
                y_true.append(class_idx)
                y_pred.append(pred_class_idx)
                total += 1
            except Exception as e:
                errors += 1
                print(f"    WARNING: failed on {img_path.name}: {e}")

    if total == 0:
        print("ERROR: No images were successfully evaluated.")
        sys.exit(1)

    y_true = np.array(y_true)
    y_pred = np.array(y_pred)

    # ── Confusion matrix ──────────────────────────────────────────────────
    cm = np.zeros((n_classes, n_classes), dtype=int)
    for t, p in zip(y_true, y_pred):
        cm[t][p] += 1

    # ── Per-class metrics ─────────────────────────────────────────────────
    precision = np.zeros(n_classes)
    recall    = np.zeros(n_classes)
    f1        = np.zeros(n_classes)
    support   = np.zeros(n_classes, dtype=int)

    for i in range(n_classes):
        tp = cm[i][i]
        fp = cm[:, i].sum() - tp
        fn = cm[i, :].sum() - tp
        support[i] = cm[i, :].sum()

        precision[i] = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall[i]    = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1[i]        = (2 * precision[i] * recall[i] / (precision[i] + recall[i])
                        if (precision[i] + recall[i]) > 0 else 0.0)

    accuracy      = (y_true == y_pred).sum() / total
    macro_f1      = f1.mean()
    weighted_f1   = (f1 * support).sum() / support.sum()
    macro_prec    = precision.mean()
    macro_recall  = recall.mean()

    # ── Print results ─────────────────────────────────────────────────────
    lines = []
    lines.append("\n" + "="*65)
    lines.append("  JAW CRUSHER MONITOR — MODEL EVALUATION RESULTS")
    lines.append("="*65)
    lines.append(f"  Model   : {weights}")
    lines.append(f"  Dataset : {data_dir}")
    lines.append(f"  Images  : {total} evaluated, {errors} errors")
    lines.append(f"  Conf threshold : {conf}")
    lines.append("="*65)
    lines.append(f"\n  Overall Accuracy : {accuracy*100:.2f}%")
    lines.append(f"  Macro F1         : {macro_f1*100:.2f}%")
    lines.append(f"  Weighted F1      : {weighted_f1*100:.2f}%")
    lines.append(f"  Macro Precision  : {macro_prec*100:.2f}%")
    lines.append(f"  Macro Recall     : {macro_recall*100:.2f}%")
    lines.append("\n" + "-"*65)
    lines.append(f"  {'Class':<28} {'Prec':>6} {'Recall':>6} {'F1':>6} {'Support':>8}")
    lines.append("-"*65)
    for i, cls in enumerate(classes):
        lines.append(
            f"  {cls:<28} {precision[i]*100:>5.1f}% {recall[i]*100:>5.1f}% "
            f"{f1[i]*100:>5.1f}% {support[i]:>8}"
        )
    lines.append("-"*65)

    lines.append("\n  Confusion Matrix (rows=actual, cols=predicted):")
    header = "  " + " "*28 + "".join(f"{c[:10]:>12}" for c in classes)
    lines.append(header)
    for i, cls in enumerate(classes):
        row = f"  {cls:<28}" + "".join(f"{cm[i][j]:>12}" for j in range(n_classes))
        lines.append(row)
    lines.append("="*65 + "\n")

    report = "\n".join(lines)
    print(report)

    # ── Save text report ──────────────────────────────────────────────────
    out_dir = Path("model_eval")
    out_dir.mkdir(exist_ok=True)
    report_path = out_dir / "eval_results.txt"
    report_path.write_text(report)
    print(f"  Report saved: {report_path}")

    # ── Save confusion matrix image ───────────────────────────────────────
    if HAS_MPL:
        fig, ax = plt.subplots(figsize=(8, 6))
        cmap = LinearSegmentedColormap.from_list("blue", ["#ffffff", "#1565C0"])
        im   = ax.imshow(cm, cmap=cmap)
        plt.colorbar(im, ax=ax)
        ax.set_xticks(range(n_classes))
        ax.set_xticklabels(classes, rotation=30, ha="right")
        ax.set_yticks(range(n_classes))
        ax.set_yticklabels(classes)
        ax.set_xlabel("Predicted")
        ax.set_ylabel("Actual")
        ax.set_title(f"Confusion Matrix — YOLOv8s-cls\nAccuracy: {accuracy*100:.1f}%  |  Weighted F1: {weighted_f1*100:.1f}%")
        for i in range(n_classes):
            for j in range(n_classes):
                color = "white" if cm[i][j] > cm.max() * 0.5 else "black"
                ax.text(j, i, str(cm[i][j]), ha="center", va="center",
                        fontsize=14, fontweight="bold", color=color)
        plt.tight_layout()
        img_path = out_dir / "confusion_matrix.png"
        plt.savefig(img_path, dpi=150)
        plt.close()
        print(f"  Confusion matrix image saved: {img_path}")

    print("\n  Use the output above to add real metrics to README.\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate YOLOv8 jaw crusher classifier")
    parser.add_argument("--data",    required=True,
                        help="Path to dataset folder (must contain test/ subdirectory with class folders)")
    parser.add_argument("--weights", default="weights/best.pt",
                        help="Path to model weights (default: weights/best.pt)")
    parser.add_argument("--conf",    type=float, default=0.0,
                        help="Confidence threshold for evaluation (default: 0.0 — evaluate all predictions)")
    parser.add_argument("--imgsz",  type=int, default=224,
                        help="Inference image size (default: 224)")
    args = parser.parse_args()

    run_eval(args.data, args.weights, args.conf, args.imgsz)
