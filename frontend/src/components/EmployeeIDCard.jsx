import { useRef, useState, useEffect } from 'react';
import { User, Download, Printer } from 'lucide-react';
import jsPDF from 'jspdf';
import api from '../services/api';
import { getServerBaseUrl } from '../utils/apiUrl';

// ─── Company Constants matching Guard CRM & Reference Card ────────────────────
const COMPANY_NAME_1 = "EAGLE EYE";
const COMPANY_NAME_2 = "SECURITY SERVICE";
const COMPANY_TAGLINE = "ALWAYS VIGILANT";
const COMPANY_ADDRESS = "No. 418, Shivalik Satyamev, SP Ring Rd Junction, Ambli - Bopal Rd Ahmedabad, Gujarat - 380058";
const COMPANY_PHONE = "+91 88665 81124";
const COMPANY_EMAIL = "info@eagleeyesecuritygroup.in";
const COMPANY_WEBSITE = "www.eagleeyesecuritygroup.in";

// ─── Brand Colors ─────────────────────────────────────────────────────────────
const RED = "#d12525";
const BLUE = "#152c56";
const RED_RGB = [209, 37, 37];
const BLUE_RGB = [21, 44, 86];
const GRAY_RGB = [107, 114, 128];
const WHITE = [255, 255, 255];
const DARK = [17, 24, 39];
const MID = [55, 65, 81];
const LIGHT = [243, 244, 246];

// ─── Card Size Tuning (ISO ID-1 Base: 85.6mm × 54mm) ──────────────────────────
const BASE_CW = 85.6;
const BASE_CH = 54;
const CARD_SCALE = 1.2;
const CARD_WIDTH_SCALE = 1.08;
const FONT_SCALE = 1.35;
const CW = BASE_CW * CARD_WIDTH_SCALE; // 92.45mm
const PDF_TOP_MARGIN = 15;
const PDF_CARD_GAP = 1;
const PHOTO_BASE_W = 19.6;
const PHOTO_BASE_INNER_W = 18.7;

const cardCoords = (ox, oy) => {
  const uw = (v) => v * CARD_WIDTH_SCALE;
  const uh = (v) => v * CARD_SCALE;
  const ur = (v) => (uw(v) + uh(v)) / 2;
  return {
    uw,
    uh,
    ur,
    x: (v) => ox + uw(v),
    y: (v) => oy + uh(v),
    fs: (size) => size * FONT_SCALE,
    lw: (width) => width * ur(1),
  };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtDate = (d) => {
  if (!d || isNaN(d.getTime())) return "N/A";
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
};

const getValidUntil = (employee) => {
  if (employee?.date_of_joining) {
    const d = new Date(employee.date_of_joining);
    if (!isNaN(d.getTime())) {
      d.setFullYear(d.getFullYear() + 1);
      return d;
    }
  }
  const fallback = new Date();
  fallback.setFullYear(fallback.getFullYear() + 1);
  return fallback;
};

// "AKASH PANCHAL" / "akash panchal" -> "Akash Panchal"
const toProperCase = (name) => {
  return String(name || '')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

// Available width (px) for the Name value in IDCardFront's details column:
// 400 card - 28 content padding - 16 photo/details gap - 76 photo col - 80 label - 12 colon - 4 padding
const NAME_VALUE_MAX_WIDTH_PX = 184;

let measureCanvas = null;
const measureTextWidth = (text, font) => {
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  ctx.font = font;
  return ctx.measureText(text).width;
};

// Shrinks the name font size just enough to fit maxWidthPx instead of letting it get clipped.
const fitNameFontSizePx = (name, maxWidthPx, baseSize = 11, minSize = 7) => {
  const width = measureTextWidth(name, `700 ${baseSize}px Arial, Helvetica, sans-serif`);
  if (width <= maxWidthPx || width === 0) return baseSize;
  return Math.max(minSize, Math.floor(baseSize * (maxWidthPx / width) * 10) / 10);
};

const formatGuardId = (emp) => {
  if (!emp) return "N/A";
  if (emp.employee_id && String(emp.employee_id).startsWith("EESS")) return emp.employee_id;
  if (emp.id != null) return `EESS${emp.id}`;
  return emp.employee_id || "N/A";
};

const resolvePhotoUrl = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  const base = getServerBaseUrl().replace(/\/+$/, '');
  const cleanPath = trimmed.replace(/^\/+/, '');
  if (cleanPath.startsWith('uploads/')) {
    return `${base}/${cleanPath}`;
  }
  return `${base}/uploads/docs/${cleanPath}`;
};

const resolveLogoUrl = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  const base = getServerBaseUrl().replace(/\/+$/, '');
  const cleanPath = trimmed.replace(/^\/+/, '');
  return `${base}/${cleanPath}`;
};

// Robust image loader with fetch blob fallback (eliminates CORS canvas taints)
const prepareClippedPhoto = (url, widthPx = 360, heightPx = 420, radiusPx = 18) => {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const processImage = (img) => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = widthPx;
        canvas.height = heightPx;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);

        ctx.clearRect(0, 0, widthPx, heightPx);

        // Rounded rectangle clipping path
        ctx.beginPath();
        const r = radiusPx, w = widthPx, h = heightPx;
        ctx.moveTo(r, 0);
        ctx.lineTo(w - r, 0);
        ctx.quadraticCurveTo(w, 0, w, r);
        ctx.lineTo(w, h - r);
        ctx.quadraticCurveTo(w, h, w - r, h);
        ctx.lineTo(r, h);
        ctx.quadraticCurveTo(0, h, 0, h - r);
        ctx.lineTo(0, r);
        ctx.quadraticCurveTo(0, 0, r, 0);
        ctx.closePath();
        ctx.clip();

        // Exact object-fit: cover (fills box 100%, zero gap/white-space)
        const imgW = img.naturalWidth || img.width;
        const imgH = img.naturalHeight || img.height;
        const imgAspect = imgW / imgH;
        const targetAspect = widthPx / heightPx;
        let sx = 0, sy = 0, sw = imgW, sh = imgH;

        if (imgAspect > targetAspect) {
          sw = imgH * targetAspect;
          sx = (imgW - sw) / 2;
        } else {
          sh = imgW / targetAspect;
          sy = (imgH - sh) / 2;
        }

        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, widthPx, heightPx);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        console.warn('Clipped photo processing error:', err);
        resolve(null);
      }
    };

    fetch(url, { mode: 'cors' })
      .then((res) => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      })
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          processImage(img);
          URL.revokeObjectURL(blobUrl);
        };
        img.onerror = () => {
          URL.revokeObjectURL(blobUrl);
          fallbackDirect();
        };
        img.src = blobUrl;
      })
      .catch(() => fallbackDirect());

    function fallbackDirect() {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => processImage(img);
      img.onerror = () => {
        console.warn('Failed to load photo via direct img fallback:', url);
        resolve(null);
      };
      img.src = url;
    }
  });
};

const prepareSquareLogo = (url, sizePx = 240) => {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const processImage = (img) => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = sizePx;
        canvas.height = sizePx;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);

        ctx.clearRect(0, 0, sizePx, sizePx);

        // Object-fit: contain (scale without distortion, centered)
        const imgW = img.naturalWidth || img.width;
        const imgH = img.naturalHeight || img.height;
        const scale = Math.min(sizePx / imgW, sizePx / imgH);
        const drawW = imgW * scale;
        const drawH = imgH * scale;
        const dx = (sizePx - drawW) / 2;
        const dy = (sizePx - drawH) / 2;

        ctx.drawImage(img, 0, 0, imgW, imgH, dx, dy, drawW, drawH);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        console.warn('Logo processing error:', err);
        resolve(null);
      }
    };

    fetch(url, { mode: 'cors' })
      .then((res) => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      })
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          processImage(img);
          URL.revokeObjectURL(blobUrl);
        };
        img.onerror = () => {
          URL.revokeObjectURL(blobUrl);
          fallbackDirect();
        };
        img.src = blobUrl;
      })
      .catch(() => fallbackDirect());

    function fallbackDirect() {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => processImage(img);
      img.onerror = () => resolve(null);
      img.src = url;
    }
  });
};

// ─── PDF Vector Drawing Helpers ───────────────────────────────────────────────
const pdfHelpers = (pdf) => ({
  fill: (c) => pdf.setFillColor(...c),
  text: (c) => pdf.setTextColor(...c),
  draw: (c) => pdf.setDrawColor(...c),
  rect: (x, y, w, h, c) => {
    pdf.setFillColor(...c);
    pdf.rect(x, y, w, h, "F");
  },
  rRect: (x, y, w, h, r, c, stroke = false) => {
    pdf.setFillColor(...c);
    pdf.roundedRect(x, y, w, h, r, r, stroke ? "FD" : "F");
  },
  line: (x1, y1, x2, y2, c) => {
    pdf.setDrawColor(...c);
    pdf.line(x1, y1, x2, y2);
  },
});

// ─── Draw Front Card (PDF Vector) ─────────────────────────────────────────────
const drawFront = async (pdf, employee, ox, oy, photoDataUrl, logoDataUrl) => {
  const p = pdfHelpers(pdf);
  const c = cardCoords(ox, oy);

  // Card background + border
  p.fill(WHITE);
  p.draw([229, 231, 235]);
  pdf.setLineWidth(c.lw(0.2));
  pdf.rect(c.x(0), c.y(0), c.uw(BASE_CW), c.uh(BASE_CH), "FD");

  // Blue top bar
  p.rect(c.x(0), c.y(0), c.uw(BASE_CW), c.uh(1.5), BLUE_RGB);

  // ── Header ──────────────────────────────────────────────────────────────────
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(c.fs(11));
  p.text(RED_RGB);
  pdf.text(COMPANY_NAME_1, c.x(3), c.y(7));

  pdf.setFontSize(c.fs(7));
  p.text(BLUE_RGB);
  pdf.text(COMPANY_NAME_2, c.x(3), c.y(10.2));

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(c.fs(4.5));
  p.text(GRAY_RGB);
  pdf.text(COMPANY_TAGLINE, c.x(3), c.y(12.5));

  // Logo in upper right
  if (logoDataUrl) {
    try {
      pdf.addImage(logoDataUrl, "PNG", c.x(BASE_CW - 12), c.y(3), c.uw(9), c.uh(9));
    } catch {
      /* skip if logo unavailable */
    }
  }

  // Divider line
  pdf.setLineWidth(c.lw(0.2));
  p.line(c.x(3), c.y(14), c.x(BASE_CW - 3), c.y(14), [229, 231, 235]);

  // ── Employee ID above photo ─────────────────────────────────────────────────
  const photoX = c.x(3);
  const photoY = c.y(18);
  const photoW = c.uw(PHOTO_BASE_W);
  const photoH = c.uh(21);
  const photoR = c.ur(1);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(c.fs(5));
  p.text(BLUE_RGB);
  pdf.text(formatGuardId(employee), photoX, c.y(16.8));

  // ── Photo box background ────────────────────────────────────────────────────
  p.fill(LIGHT);
  pdf.roundedRect(photoX, photoY, photoW, photoH, photoR, photoR, "F");

  // ── Draw Photo inside box (100% edge-to-edge, zero margin/gap) ──────────────
  if (photoDataUrl) {
    try {
      pdf.addImage(photoDataUrl, "PNG", photoX, photoY, photoW, photoH);
    } catch {
      /* no photo */
    }
  } else {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(c.fs(4.5));
    p.text(GRAY_RGB);
    pdf.text("NO PHOTO", photoX + photoW / 2, photoY + photoH / 2, { align: "center" });
  }

  // ── Crisp Red Border ON TOP of Photo (zero gap, cleanly frames photo, no corner protrusion) ─
  pdf.setDrawColor(...RED_RGB);
  pdf.setLineWidth(c.lw(0.5));
  pdf.roundedRect(photoX, photoY, photoW, photoH, photoR, photoR, "S");

  // ── Detail rows ─────────────────────────────────────────────────────────────
  const rows = [
    ["Name", toProperCase(employee.full_name) || "N/A"],
    ["Designation", employee.designation || "Security Guard"],
    ["D.O.B", employee.date_of_birth ? fmtDate(new Date(employee.date_of_birth)) : "N/A"],
    ["Gender", employee.gender || "N/A"],
    ["D.O.J", employee.date_of_joining ? fmtDate(new Date(employee.date_of_joining)) : "N/A"],
    ["Valid Upto", fmtDate(getValidUntil(employee))],
  ];

  let rowY = c.y(19.5);
  const valueX = c.x(54);
  const valueMaxWidth = c.x(BASE_CW - 3) - valueX;
  rows.forEach(([label, value]) => {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(c.fs(6));
    p.text(MID);
    pdf.text(label, c.x(32), rowY);
    pdf.text(":", c.x(50), rowY);
    pdf.setFont("helvetica", "bold");
    p.text(DARK);
    let valueFontSize = c.fs(6);
    pdf.setFontSize(valueFontSize);
    if (label === "Name") {
      const textWidth = pdf.getTextWidth(value);
      if (textWidth > valueMaxWidth) {
        valueFontSize = Math.max(c.fs(3.6), valueFontSize * (valueMaxWidth / textWidth));
        pdf.setFontSize(valueFontSize);
      }
    }
    pdf.text(value, valueX, rowY);
    rowY += c.uh(4.2);
  });

  // ── Bottom Signatory Strip ──────────────────────────────────────────────────
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(c.fs(5.5));
  p.text(MID);
  pdf.text("For Eagle Eye Security Service", c.x(3), c.y(BASE_CH - 9));
  pdf.text("Authorised Signatory", c.x(3), c.y(BASE_CH - 2));
};

// ─── Draw Back Card (PDF Vector) ──────────────────────────────────────────────
const drawBack = async (pdf, ox, oy, logoDataUrl) => {
  const p = pdfHelpers(pdf);
  const c = cardCoords(ox, oy);

  // Card background + border
  p.fill(WHITE);
  p.draw([229, 231, 235]);
  pdf.setLineWidth(c.lw(0.2));
  pdf.roundedRect(
    c.x(0),
    c.y(0),
    c.uw(BASE_CW),
    c.uh(BASE_CH),
    c.ur(2),
    c.ur(2),
    "FD"
  );

  // Blue top bar
  p.rect(c.x(0), c.y(0), c.uw(BASE_CW), c.uh(1.5), BLUE_RGB);

  // ── Left Column Header ──────────────────────────────────────────────────────
  if (logoDataUrl) {
    try {
      pdf.addImage(logoDataUrl, "PNG", c.x(3), c.y(3), c.uw(9), c.uh(9));
    } catch {
      /* skip */
    }
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(c.fs(11));
  p.text(RED_RGB);
  pdf.text(COMPANY_NAME_1, c.x(13), c.y(6));

  pdf.setFontSize(c.fs(7));
  p.text(BLUE_RGB);
  pdf.text(COMPANY_NAME_2, c.x(13), c.y(9));

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(c.fs(4.5));
  p.text(GRAY_RGB);
  pdf.text(COMPANY_TAGLINE, c.x(13), c.y(11.5));

  // Left divider
  pdf.setLineWidth(c.lw(0.2));
  p.line(c.x(3), c.y(14), c.x(57), c.y(14), [229, 231, 235]);

  // ── Left Column Contacts ────────────────────────────────────────────────────
  const contacts = [
    ["Addr.", COMPANY_ADDRESS],
    ["Tel.", COMPANY_PHONE],
    ["Email", COMPANY_EMAIL],
    ["Web", COMPANY_WEBSITE],
  ];
  let cy = c.y(18);
  contacts.forEach(([label, text]) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(c.fs(6));
    p.text(BLUE_RGB);
    pdf.text(`${label}`, c.x(3), cy);
    pdf.setFont("helvetica", "normal");
    p.text(MID);
    const textLines = pdf.splitTextToSize(text, c.uw(44));
    pdf.text(textLines, c.x(11), cy);
    cy += c.uh(3.5) * textLines.length;
  });

  // Vertical divider line
  pdf.setLineWidth(c.lw(0.2));
  p.line(c.x(58), c.y(2), c.x(58), c.y(BASE_CH - 9), [229, 231, 235]);

  // ── Right Column: Emergency Box ─────────────────────────────────────────────
  const EP_X = c.x(60);
  const EP_W = c.uw(BASE_CW - 62);
  const headerH = c.uh(5);
  const rowH = c.uh(5.5);
  const r = c.ur(1);
  let currentY = c.y(3);

  // Red header box
  pdf.setFillColor(...RED_RGB);
  pdf.rect(EP_X, currentY + r, EP_W, headerH - r, "F");
  pdf.rect(EP_X + r, currentY, EP_W - 2 * r, r, "F");
  pdf.circle(EP_X + r, currentY + r, r, "F");
  pdf.circle(EP_X + EP_W - r, currentY + r, r, "F");

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(c.fs(4.8));
  p.text(WHITE);
  pdf.text("EMERGENCY", EP_X + EP_W / 2, currentY + c.uh(3.5), {
    align: "center",
  });

  currentY += headerH;

  const emergency = [
    ["Ambulance", "108"],
    ["Police", "100 / 112"],
    ["Fire Brigade", "101"],
  ];

  emergency.forEach(([label, num], index) => {
    pdf.setFillColor(255, 248, 248);
    pdf.rect(EP_X, currentY, EP_W, rowH, "F");

    if (index !== emergency.length - 1) {
      pdf.setDrawColor(229, 231, 235);
      pdf.setLineWidth(c.lw(0.1));
      pdf.line(EP_X, currentY + rowH, EP_X + EP_W, currentY + rowH);
    }

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(c.fs(4.5));
    p.text(MID);
    pdf.text(label, EP_X + c.uw(1.5), currentY + c.uh(3.5));

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(c.fs(6));
    p.text(RED_RGB);
    pdf.text(num, EP_X + EP_W - c.uw(1.5), currentY + c.uh(3.5), {
      align: "right",
    });

    currentY += rowH;
  });

  // Footer of emergency panel
  const bottomRadius = c.ur(1.5);
  const footerHeight = c.uh(5);

  pdf.setFillColor(...BLUE_RGB);
  pdf.rect(EP_X, currentY, EP_W, footerHeight - bottomRadius, "F");
  pdf.rect(
    EP_X + bottomRadius,
    currentY + footerHeight - bottomRadius,
    EP_W - 2 * bottomRadius,
    bottomRadius,
    "F"
  );
  pdf.circle(
    EP_X + bottomRadius,
    currentY + footerHeight - bottomRadius,
    bottomRadius,
    "F"
  );
  pdf.circle(
    EP_X + EP_W - bottomRadius,
    currentY + footerHeight - bottomRadius,
    bottomRadius,
    "F"
  );

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(c.fs(3.6));
  pdf.setTextColor(200, 210, 225);

  const textY = currentY + footerHeight / 2 - c.uh(0.5);
  pdf.text("In case of emergency, call immediately", EP_X + EP_W / 2, textY, {
    align: "center",
    maxWidth: EP_W - c.uw(4),
    lineHeightFactor: 1.2,
  });

  // ── Bottom Solid Blue Bar ───────────────────────────────────────────────────
  p.rect(c.x(0), c.y(BASE_CH - 8), c.uw(BASE_CW), c.uh(8), BLUE_RGB);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(c.fs(5));
  p.text([190, 200, 220]);
  pdf.text(
    "Note — This card is only valid on site and for company's internal purpose",
    c.x(BASE_CW / 2),
    c.y(BASE_CH - 3.5),
    { align: "center" }
  );
};

// ─── Front Card (On-Screen Preview Component) ─────────────────────────────────
export const IDCardFront = ({ employee, photoUrl, logoUrl }) => {
  const empCode = formatGuardId(employee);
  const validUntil = getValidUntil(employee);

  const rows = [
    ["Name", toProperCase(employee?.full_name) || "N/A"],
    ["Designation", employee?.designation || "Security Guard"],
    ["D.O.B", employee?.date_of_birth ? fmtDate(new Date(employee.date_of_birth)) : "N/A"],
    ["Gender", employee?.gender || "N/A"],
    ["D.O.J", employee?.date_of_joining ? fmtDate(new Date(employee.date_of_joining)) : "N/A"],
    ["Valid Upto", fmtDate(validUntil)],
  ];

  return (
    <div
      style={{
        width: "400px",
        height: "270px",
        backgroundColor: "#ffffff",
        borderRadius: "8px",
        overflow: "hidden",
        position: "relative",
        fontFamily: "Arial, Helvetica, sans-serif",
        boxShadow: "0 4px 16px rgba(0,0,0,0.14)",
        border: "1px solid #e5e7eb",
        boxSizing: "border-box",
      }}
    >
      {/* Top blue bar */}
      <div style={{ backgroundColor: BLUE, height: "6px", width: "100%" }} />

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 14px 4px",
        }}
      >
        <div>
          <div style={{ fontSize: "17px", fontWeight: 900, color: RED, letterSpacing: "0.5px", lineHeight: 1 }}>
            {COMPANY_NAME_1}
          </div>
          <div style={{ fontSize: "11px", fontWeight: 700, color: BLUE, letterSpacing: "2px", lineHeight: 1.3 }}>
            {COMPANY_NAME_2}
          </div>
          <div style={{ fontSize: "7.5px", color: "#6b7280", letterSpacing: "0.5px" }}>
            {COMPANY_TAGLINE}
          </div>
        </div>
        {logoUrl && (
          <img
            src={logoUrl}
            alt="Agency Logo"
            style={{ width: "40px", height: "40px", objectFit: "contain" }}
            onError={(e) => {
              if (e.currentTarget.src !== window.location.origin + '/logo.png') {
                e.currentTarget.src = '/logo.png';
              } else {
                e.currentTarget.style.display = 'none';
              }
            }}
          />
        )}
      </div>

      {/* Divider */}
      <div style={{ height: "1px", backgroundColor: "#e5e7eb", margin: "0 14px" }} />

      {/* Content: Photo + Details */}
      <div style={{ display: "flex", gap: "16px", padding: "8px 14px 4px" }}>
        {/* Left: Code + Photo */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px", flexShrink: 0 }}>
          <span style={{ fontSize: "10.5px", fontWeight: 700, color: BLUE, letterSpacing: "0.5px" }}>
            {empCode}
          </span>
          <div
            style={{
              width: "76px",
              height: "96px",
              border: `2px solid ${RED}`,
              borderRadius: "5px",
              overflow: "hidden",
              backgroundColor: "#f3f4f6",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {photoUrl ? (
              <img
                src={photoUrl}
                alt="guard"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            ) : (
              <User style={{ width: "36px", height: "36px", color: "#9ca3af" }} />
            )}
          </div>
        </div>

        {/* Right: Details Table with Colons Aligned */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px", justifyContent: "center", minWidth: 0 }}>
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: "flex", alignItems: "baseline", fontSize: "11px", minWidth: 0 }}>
              <span style={{ color: "#374151", fontWeight: 600, width: "80px", flexShrink: 0 }}>{label}</span>
              <span style={{ color: "#374151", width: "12px", textAlign: "center", flexShrink: 0 }}>:</span>
              <span
                style={{
                  color: "#111827",
                  fontWeight: 700,
                  paddingLeft: "4px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  ...(label === "Name" ? { fontSize: `${fitNameFontSizePx(value, NAME_VALUE_MAX_WIDTH_PX)}px` } : {}),
                }}
              >
                {value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Signatory */}
      <div
        style={{
          position: "absolute",
          bottom: "8px",
          left: "14px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <p style={{ fontSize: "10px", color: "#374151", margin: 0 }}>For Eagle Eye Security Service</p>
        <p style={{ fontSize: "10px", color: "#374151", margin: 0 }}>Authorised Signatory</p>
      </div>
    </div>
  );
};

// ─── Back Card (On-Screen Preview Component) ──────────────────────────────────
export const IDCardBack = ({ logoUrl }) => {
  return (
    <div
      style={{
        width: "400px",
        height: "270px",
        backgroundColor: "#ffffff",
        borderRadius: "8px",
        overflow: "hidden",
        position: "relative",
        fontFamily: "Arial, Helvetica, sans-serif",
        boxShadow: "0 4px 16px rgba(0,0,0,0.14)",
        border: "1px solid #e5e7eb",
        boxSizing: "border-box",
      }}
    >
      {/* Top blue bar */}
      <div style={{ backgroundColor: BLUE, height: "6px", width: "100%" }} />

      <div
        style={{
          padding: "8px 12px 0",
          display: "flex",
          gap: "10px",
        }}
      >
        {/* Left column: Company info + Contacts */}
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
            {logoUrl && (
              <img
                src={logoUrl}
                alt="Agency Logo"
                style={{ width: "36px", height: "36px", objectFit: "contain", flexShrink: 0 }}
                onError={(e) => {
                  if (e.currentTarget.src !== window.location.origin + '/logo.png') {
                    e.currentTarget.src = '/logo.png';
                  } else {
                    e.currentTarget.style.display = 'none';
                  }
                }}
              />
            )}
            <div>
              <div style={{ fontSize: "14px", fontWeight: 900, color: RED, letterSpacing: "0.5px", lineHeight: 1 }}>
                {COMPANY_NAME_1}
              </div>
              <div style={{ fontSize: "9px", fontWeight: 700, color: BLUE, letterSpacing: "1.5px", lineHeight: 1.3 }}>
                {COMPANY_NAME_2}
              </div>
              <div style={{ fontSize: "6.5px", color: "#6b7280", letterSpacing: "0.5px" }}>
                {COMPANY_TAGLINE}
              </div>
            </div>
          </div>

          <div style={{ height: "1px", backgroundColor: "#e5e7eb", marginBottom: "8px" }} />

          {/* Contact Details with bold blue labels - NO EMOJIS */}
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "6px", fontSize: "9.5px", lineHeight: 1.3 }}>
              <span style={{ fontWeight: 700, color: BLUE, width: "38px", flexShrink: 0 }}>Addr.</span>
              <span style={{ color: "#374151" }}>{COMPANY_ADDRESS}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "6px", fontSize: "9.5px", lineHeight: 1.3 }}>
              <span style={{ fontWeight: 700, color: BLUE, width: "38px", flexShrink: 0 }}>Tel.</span>
              <span style={{ color: "#374151" }}>{COMPANY_PHONE}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "6px", fontSize: "9.5px", lineHeight: 1.3 }}>
              <span style={{ fontWeight: 700, color: BLUE, width: "38px", flexShrink: 0 }}>Email</span>
              <span style={{ color: "#374151" }}>{COMPANY_EMAIL}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "6px", fontSize: "9.5px", lineHeight: 1.3 }}>
              <span style={{ fontWeight: 700, color: BLUE, width: "38px", flexShrink: 0 }}>Web</span>
              <span style={{ color: "#374151" }}>{COMPANY_WEBSITE}</span>
            </div>
          </div>
        </div>

        {/* Vertical divider */}
        <div style={{ width: "1px", backgroundColor: "#e5e7eb", flexShrink: 0 }} />

        {/* Right column: Emergency Box */}
        <div style={{ width: "120px", flexShrink: 0 }}>
          {/* Header */}
          <div
            style={{
              backgroundColor: RED,
              borderRadius: "5px 5px 0 0",
              padding: "4px 6px",
              textAlign: "center",
            }}
          >
            <span style={{ fontSize: "9.5px", fontWeight: 900, color: "#ffffff", letterSpacing: "0.5px" }}>
              EMERGENCY
            </span>
          </div>

          {/* 3 rows - NO EMOJIS */}
          {[
            ["Ambulance", "108"],
            ["Police", "100 / 112"],
            ["Fire Brigade", "101"],
          ].map(([label, num]) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "4px 6px",
                borderBottom: "1px solid #f3f4f6",
                backgroundColor: "#fff8f8",
              }}
            >
              <span style={{ fontSize: "8.5px", color: "#374151", fontWeight: 500 }}>{label}</span>
              <span style={{ fontSize: "9.5px", fontWeight: 800, color: RED }}>{num}</span>
            </div>
          ))}

          {/* Footer */}
          <div
            style={{
              backgroundColor: BLUE,
              borderRadius: "0 0 5px 5px",
              padding: "4px 6px",
              textAlign: "center",
            }}
          >
            <span style={{ fontSize: "7.5px", color: "rgba(255,255,255,0.85)", lineHeight: 1.2, display: "block" }}>
              In case of emergency, call immediately
            </span>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: BLUE,
          padding: "5px 12px",
          textAlign: "center",
        }}
      >
        <span style={{ fontSize: "8.5px", color: "rgba(255,255,255,0.8)" }}>
          Note — This card is only valid on site and for company's internal purpose
        </span>
      </div>
    </div>
  );
};

// ─── Print Profile (A4 Sheet, Print-Only) ─────────────────────────────────────
const PRINT_STYLES = `
  @media print {
    @page { margin: 15mm; size: A4 portrait; }
    #root { display: none !important; }
    .emp-print-wrapper { display: block !important; position: relative !important; width: 100%; background: #fff; }
  }
  @media screen { .emp-print-wrapper { display: none !important; } }
`;

const PrintField = ({ label, value }) => (
  <div style={{ marginBottom: "8px" }}>
    <div style={{ fontSize: "9px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "2px" }}>
      {label}
    </div>
    <div style={{ fontSize: "12px", color: "#111827", fontWeight: 500 }}>{value || "—"}</div>
  </div>
);

const PrintSection = ({ title, children, cols = 3 }) => (
  <div style={{ marginBottom: "16px" }}>
    <div
      style={{
        fontSize: "10px",
        fontWeight: 700,
        color: "#152c56",
        textTransform: "uppercase",
        letterSpacing: "1px",
        borderBottom: "1.5px solid #152c56",
        paddingBottom: "4px",
        marginBottom: "10px",
      }}
    >
      {title}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: "8px 16px" }}>
      {children}
    </div>
  </div>
);

const EmployeePrintProfile = ({ employee, photoUrl, logoUrl }) => {
  const joiningFormatted = employee?.date_of_joining
    ? new Date(employee.date_of_joining).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";
  const dobFormatted = employee?.date_of_birth
    ? new Date(employee.date_of_birth).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />
      <div className="emp-print-wrapper" style={{ fontFamily: "Arial, sans-serif", color: "#111827", backgroundColor: "#fff" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "3px solid #152c56",
            paddingBottom: "12px",
            marginBottom: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {logoUrl && (
              <img
                src={logoUrl}
                alt="Agency Logo"
                style={{ width: "48px", height: "48px", objectFit: "contain" }}
                onError={(e) => {
                  if (e.currentTarget.src !== window.location.origin + '/logo.png') {
                    e.currentTarget.src = '/logo.png';
                  } else {
                    e.currentTarget.style.display = 'none';
                  }
                }}
              />
            )}
            <div>
              <div style={{ fontSize: "18px", fontWeight: 900, lineHeight: 1 }}>
                <span style={{ color: "#d12525" }}>{COMPANY_NAME_1} </span>
                <span style={{ color: "#152c56" }}>{COMPANY_NAME_2}</span>
              </div>
              <div style={{ fontSize: "9px", color: "#6b7280", letterSpacing: "0.5px" }}>
                {COMPANY_TAGLINE}
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#152c56" }}>EMPLOYEE PROFILE</div>
            <div style={{ fontSize: "9px", color: "#6b7280", marginTop: "2px" }}>
              Generated: {new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
            </div>
            <div style={{ fontSize: "9px", color: "#6b7280" }}>ID: {formatGuardId(employee)}</div>
          </div>
        </div>

        {/* Identity strip */}
        <div
          style={{
            display: "flex",
            gap: "16px",
            alignItems: "flex-start",
            backgroundColor: "#f8fafc",
            border: "1px solid #e5e7eb",
            borderRadius: "6px",
            padding: "12px",
            marginBottom: "16px",
          }}
        >
          <div
            style={{
              width: "80px",
              height: "100px",
              flexShrink: 0,
              border: "2px solid #152c56",
              borderRadius: "4px",
              overflow: "hidden",
              backgroundColor: "#e5e7eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={employee.full_name}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            ) : (
              <span style={{ fontSize: "28px", color: "#9ca3af" }}>👤</span>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "20px", fontWeight: 800, color: "#111827", marginBottom: "2px" }}>
              {employee.full_name}
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "8px" }}>
              <span style={{ fontSize: "11px", fontWeight: 600, color: "#152c56", backgroundColor: "#e0e7ff", padding: "2px 8px", borderRadius: "4px" }}>
                {employee.designation || "Employee"}
              </span>
              <span style={{ fontSize: "11px", color: "#6b7280" }}>ID: {formatGuardId(employee)}</span>
              <span style={{ fontSize: "11px", color: employee.is_active ? "#15803d" : "#b91c1c", fontWeight: 600 }}>
                {employee.is_active ? "● Active" : "○ Inactive"}
              </span>
            </div>
            <div style={{ fontSize: "11px", color: "#4b5563" }}>
              {employee.address ? `${employee.address}, ` : ""}{employee.city || ""}
            </div>
          </div>
        </div>

        {/* Personal Details */}
        <PrintSection title="Personal Details" cols={3}>
          <PrintField label="Date of Birth" value={dobFormatted} />
          <PrintField label="Gender" value={employee.gender} />
          <PrintField label="Phone" value={employee.phone} />
          <PrintField label="Email" value={employee.email} />
          <PrintField label="Aadhaar Number" value={employee.aadhar_number} />
          <PrintField label="PAN Number" value={employee.pan_number} />
        </PrintSection>

        {/* Employment Details */}
        <PrintSection title="Employment Details" cols={3}>
          <PrintField label="Date of Joining" value={joiningFormatted} />
          <PrintField label="Designation" value={employee.designation} />
          <PrintField label="Assigned Client" value={employee.client_name} />
          <PrintField label="Valid Until" value={fmtDate(getValidUntil(employee))} />
        </PrintSection>

        {/* Emergency Contact */}
        <PrintSection title="Emergency Contact" cols={2}>
          <PrintField label="Contact Person" value={employee.emergency_contact_name} />
          <PrintField label="Contact Phone" value={employee.emergency_contact_phone} />
        </PrintSection>

        {/* Declaration & Signature */}
        <div style={{ marginTop: "40px", display: "flex", justifyContent: "space-between", paddingTop: "20px", borderTop: "1px solid #e5e7eb" }}>
          <div>
            <div style={{ fontSize: "10px", color: "#6b7280", marginBottom: "40px" }}>Employee Signature:</div>
            <div style={{ width: "160px", borderBottom: "1px dashed #9ca3af" }} />
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "10px", color: "#6b7280", marginBottom: "40px" }}>Authorised Signatory:</div>
            <div style={{ width: "160px", borderBottom: "1px dashed #9ca3af", marginLeft: "auto" }} />
            <div style={{ fontSize: "9px", color: "#6b7280", marginTop: "4px" }}>Eagle Eye Security Service</div>
          </div>
        </div>
      </div>
    </>
  );
};

// ─── Main Component Export ────────────────────────────────────────────────────
export default function EmployeeIDCard({ employee }) {
  const [generating, setGenerating] = useState(false);
  const [photoDocUrl, setPhotoDocUrl] = useState(null);
  const [agencyLogoUrl, setAgencyLogoUrl] = useState(null);
  const [showLogoOnIdCard, setShowLogoOnIdCard] = useState(true);
  const [showLogoOnPrintProfile, setShowLogoOnPrintProfile] = useState(true);

  useEffect(() => {
    // 1. Fetch agency settings to get agency_logo_url + where the logo should be shown
    api.get('/settings/system/agency_settings')
      .then((res) => {
        if (res?.data) {
          const parsed = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
          if (parsed?.agency_logo_url) {
            setAgencyLogoUrl(resolveLogoUrl(parsed.agency_logo_url));
          }
          setShowLogoOnIdCard(parsed?.logo_locations?.id_card !== false);
          setShowLogoOnPrintProfile(parsed?.logo_locations?.print_profile !== false);
        }
      })
      .catch((err) => console.warn('Failed to load agency settings for ID card:', err));

    // 2. Fetch employee documents if photo_url is not directly present
    if (!employee?.photo_url && employee?.id) {
      api.get(`/employees/${employee.id}/docs`)
        .then((res) => {
          const docs = res?.data?.documents || res?.data || [];
          if (Array.isArray(docs)) {
            const photoDoc = docs.find((d) => d.document_type === 'photo');
            if (photoDoc?.file_path) {
              setPhotoDocUrl(resolvePhotoUrl(photoDoc.file_path));
            }
          }
        })
        .catch((err) => console.warn('Failed to load employee docs for photo:', err));
    }
  }, [employee?.id, employee?.photo_url]);

  const effectivePhotoUrl = resolvePhotoUrl(employee?.photo_url) || photoDocUrl;
  const effectiveLogoUrl = showLogoOnIdCard ? (agencyLogoUrl || '/logo.png') : null;
  const effectivePrintProfileLogoUrl = showLogoOnPrintProfile ? (agencyLogoUrl || '/logo.png') : null;

  const downloadPDF = async () => {
    try {
      setGenerating(true);

      // 1. Prepare clipped photo data URL (rounded corners, 100% cover, zero gap)
      let photoDataUrl = null;
      if (effectivePhotoUrl) {
        photoDataUrl = await prepareClippedPhoto(effectivePhotoUrl, 360, 428, 20);
      }

      // 2. Prepare square logo data URL (contain aspect ratio, centered transparent PNG)
      let logoDataUrl = null;
      if (effectiveLogoUrl) {
        logoDataUrl = await prepareSquareLogo(effectiveLogoUrl, 240);
      }
      if (!logoDataUrl && showLogoOnIdCard && effectiveLogoUrl !== '/logo.png') {
        logoDataUrl = await prepareSquareLogo('/logo.png', 240);
      }

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
        compress: true,
      });

      const pageW = pdf.internal.pageSize.getWidth();
      const totalCardsW = CW * 2 + PDF_CARD_GAP;
      const x0 = (pageW - totalCardsW) / 2;
      const y0 = PDF_TOP_MARGIN;

      // Draw Front and Back side-by-side matching Image 3 sample
      await drawFront(pdf, employee, x0, y0, photoDataUrl, logoDataUrl);
      await drawBack(pdf, x0 + CW + PDF_CARD_GAP, y0, logoDataUrl);

      const safeName = (employee?.full_name || "Employee").replace(/\s+/g, "_");
      pdf.save(`${safeName}_ID_Card.pdf`);
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      {/* On-screen card section */}
      <div className="p-1">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-4 flex items-center gap-1.5">
          <span>🪪</span> Identity Card Preview
        </h4>

        <div className="flex flex-wrap gap-6 justify-center mb-6 overflow-x-auto pb-2">
          <div>
            <p className="text-xs text-center text-slate-500 mb-2 uppercase tracking-wider font-semibold">Front Side</p>
            <IDCardFront employee={employee} photoUrl={effectivePhotoUrl} logoUrl={effectiveLogoUrl} />
          </div>
          <div>
            <p className="text-xs text-center text-slate-500 mb-2 uppercase tracking-wider font-semibold">Back Side</p>
            <IDCardBack logoUrl={effectiveLogoUrl} />
          </div>
        </div>

        <div className="flex justify-center gap-3 flex-wrap">
          <button
            onClick={downloadPDF}
            disabled={generating}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-xl shadow-sm transition-all cursor-pointer"
          >
            <Download className="w-4 h-4" />
            {generating ? "Generating PDF…" : "Download ID Card (PDF)"}
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl shadow-sm transition-all cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            Print Profile
          </button>
        </div>
      </div>

      {/* Print-only profile */}
      <EmployeePrintProfile employee={employee} photoUrl={effectivePhotoUrl} logoUrl={effectivePrintProfileLogoUrl} />
    </>
  );
}
