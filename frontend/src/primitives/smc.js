/**
 * Series primitive that renders order blocks, structure lines and text labels.
 *
 * Lightweight Charts has no native rectangle/annotation API, so every SMC
 * drawable is painted on the pane canvas. Coordinates are recomputed on every
 * frame, which keeps everything aligned while panning/zooming.
 */
export class SMCPrimitive {
  constructor() {
    this._drawables = [];
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;

    this._views = [
      {
        zOrder: () => 'bottom',
        renderer: () => ({ draw: (target) => this._draw(target, 'bottom') }),
      },
      {
        zOrder: () => 'top',
        renderer: () => ({ draw: (target) => this._draw(target, 'top') }),
      },
    ];
  }

  attached({ chart, series, requestUpdate }) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
  }

  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  paneViews() {
    return this._views;
  }

  setDrawables(drawables) {
    this._drawables = drawables || [];
    if (this._requestUpdate) {
      this._requestUpdate();
    }
  }

  _draw(target, layer) {
    if (!this._chart || !this._series) {
      return;
    }

    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const timeScale = this._chart.timeScale();
      const timeToX = (time) => {
        if (time == null) {
          return null;
        }
        return timeScale.timeToCoordinate(time);
      };
      const priceToY = (price) => {
        if (price == null) {
          return null;
        }
        return this._series.priceToCoordinate(price);
      };

      context.save();
      context.lineJoin = 'round';
      context.lineCap = 'round';
      let lastRightY = -Infinity;
      let lastProbabilityY = -Infinity;

      for (const drawable of this._drawables) {
        if (drawable.layer !== layer) {
          continue;
        }

        if (drawable.kind === 'rect') {
          const x1 = timeToX(drawable.fromTime);
          const x2 = drawable.toTime == null ? mediaSize.width : timeToX(drawable.toTime);
          const y1 = priceToY(drawable.top);
          const y2 = priceToY(drawable.bottom);

          if (x1 == null || y1 == null || y2 == null) {
            continue;
          }

          const right = x2 == null ? mediaSize.width : x2;
          const width = Math.max(0, right - x1);
          const height = Math.abs(y2 - y1);
          const top = Math.min(y1, y2);

          context.fillStyle = drawable.fill;
          context.fillRect(x1, top, width, height);

          if (drawable.border) {
            context.strokeStyle = drawable.border;
            context.lineWidth = drawable.borderWidth || 1;
            context.strokeRect(x1 + 0.5, top + 0.5, Math.max(0, width - 1), Math.max(0, height - 1));
          }
        } else if (drawable.kind === 'segment') {
          const x1 = timeToX(drawable.fromTime);
          const x2 = drawable.toTime == null ? mediaSize.width : timeToX(drawable.toTime);
          const y1 = priceToY(drawable.fromPrice);
          const y2 = priceToY(drawable.toPrice);

          if (x1 == null || y1 == null || y2 == null) {
            continue;
          }

          const right = x2 == null ? mediaSize.width : x2;
          context.strokeStyle = drawable.color;
          context.lineWidth = drawable.width || 1;
          context.setLineDash(dashPattern(drawable.dash));
          context.beginPath();
          context.moveTo(x1, y1);
          context.lineTo(right, y2);
          context.stroke();
          context.setLineDash([]);
        } else if (drawable.kind === 'text') {
          const x = drawable.xRight
            ? mediaSize.width - 8
            : timeToX(drawable.time);
          let y = priceToY(drawable.price);

          if (x == null || y == null) {
            continue;
          }

          if (drawable.xRight && (y < -16 || y > mediaSize.height + 16)) {
            continue;
          }

          if (drawable.xRight) {
            const last = drawable.probability ? lastProbabilityY : lastRightY;
            if (y - last < 14) {
              y = last + 14;
            }
            if (drawable.probability) {
              lastProbabilityY = y;
            } else {
              lastRightY = y;
            }
          }

          const fontSize = drawable.fontSize || 11;
          const textX = x + (drawable.offsetX || 0);
          const textY = y + (drawable.offsetY || 0);

          context.font = `${drawable.weight || 500} ${fontSize}px Inter, ui-sans-serif, system-ui, sans-serif`;
          context.textAlign = drawable.align || 'center';
          context.textBaseline = drawable.baseline || 'middle';

          if (drawable.background) {
            const metrics = context.measureText(drawable.text);
            const padX = drawable.paddingX ?? 4;
            const padY = drawable.paddingY ?? 2;
            const width = metrics.width + padX * 2;
            const height = fontSize + padY * 2;
            let boxX;
            if (context.textAlign === 'right') {
              boxX = textX - metrics.width - padX;
            } else if (context.textAlign === 'center') {
              boxX = textX - metrics.width / 2 - padX;
            } else {
              boxX = textX - padX;
            }
            let boxY;
            if (context.textBaseline === 'bottom') {
              boxY = textY - fontSize - padY;
            } else if (context.textBaseline === 'top') {
              boxY = textY - padY;
            } else {
              boxY = textY - fontSize / 2 - padY;
            }

            roundedRect(context, boxX, boxY, width, height, drawable.radius ?? 4);
            context.fillStyle = drawable.background;
            context.fill();
            if (drawable.border) {
              context.strokeStyle = drawable.border;
              context.lineWidth = 1;
              context.stroke();
            }
          }

          context.fillStyle = drawable.color;
          context.shadowColor = drawable.background ? 'transparent' : 'rgba(0, 0, 0, 0.75)';
          context.shadowBlur = drawable.background ? 0 : 3;
          context.fillText(drawable.text, textX, textY);
          context.shadowBlur = 0;
        }
      }

      context.restore();
    });
  }
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function dashPattern(style) {
  switch (style) {
    case 'dash':
      return [4, 4];
    case 'dot':
      return [1, 3];
    default:
      return [];
  }
}
