// Room Designer 3D — the PDF of a design and its estimate (js/studio.js):
// a picture of the 3D room, the measured floor plan, the design in words
// and the estimate.
//
// jsPDF is self-hosted (js/vendor/jspdf.umd.min.js, MIT licence) and only
// loaded when someone asks for a PDF, so normal page views never load it and
// no third-party server is contacted.
//
// Layout: US Letter, consistent margins, pages added as needed, and a footer
// (date, phone, email, business name, page number) on every page.

(function () {
  "use strict";

  var T = window.I18n.t;
  var script = /** @type {HTMLScriptElement | null} */ (document.currentScript);
  var JSPDF_SRC =
    script && script.src ? new URL("vendor/jspdf.umd.min.js", script.src).href : "js/vendor/jspdf.umd.min.js";
  var loading = null;

  function load() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var el = document.createElement("script");
      el.src = JSPDF_SRC;
      el.async = true;
      el.onload = function () {
        if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf);
        else reject(new Error("PDF library did not load"));
      };
      el.onerror = function () {
        el.remove();
        reject(new Error("PDF library could not be downloaded"));
      };
      document.head.appendChild(el);
    }).catch(function (err) {
      loading = null; // allow Retry
      throw err;
    });
    return loading;
  }

  var PAGE = { margin: 56, top: 60, footerHeight: 64 };

  // The PDF's built-in font only has the Windows Latin characters: feet and
  // inch marks, the minus sign and arrows are written the plain way.
  var PLAIN = {
    "\u2032": "'",
    "\u2033": '"',
    "\u2212": "-",
    "\u2192": "->",
    "\u2190": "<-",
    "\u2009": " ",
    "\u202f": " ",
  };

  function safe(text) {
    return String(text === undefined || text === null ? "" : text).replace(
      /[\u2032\u2033\u2212\u2192\u2190\u2009\u202f]/g,
      function (c) {
        return PLAIN[c];
      },
    );
  }

  // spec: {
  //   title, subtitle, preparedFor?, intro?,
  //   picture?: a JPEG data URL of the 3D room,
  //   plan?: { w, l, rects, arcs, lines, texts } in room feet, planTitle,
  //     (a text with `halo` sits on a patch of that colour, so a mark drawn
  //     under it never crosses the letters),
  //   design?: [string], designTitle,
  //   linesTitle?, lines: [{ label, detail, amount }],
  //   excluded: [{ label, value }],
  //   totals: [{ label, value, strong? }],
  //   afterTotal: [string], sections: [{ title, items: [string] }],
  //   footer: { business, phone, email, date }
  // }
  function build(spec) {
    var doc = new window.jspdf.jsPDF({ unit: "pt", format: "letter" });
    var pageWidth = doc.internal.pageSize.getWidth();
    var pageHeight = doc.internal.pageSize.getHeight();
    var left = PAGE.margin;
    var right = pageWidth - PAGE.margin;
    var width = right - left;
    var bottom = pageHeight - PAGE.footerHeight;
    var y = PAGE.top;

    function ensure(height) {
      if (y + height > bottom) {
        doc.addPage();
        y = PAGE.top;
      }
    }

    function paragraph(text, size, color, style, gap) {
      doc.setFont("helvetica", style || "normal");
      doc.setFontSize(size);
      doc.setTextColor(color);
      var lineHeight = size * 1.3;
      doc.splitTextToSize(safe(text), width).forEach(function (line) {
        ensure(lineHeight);
        doc.text(line, left, y);
        y += lineHeight;
      });
      y += gap === undefined ? 6 : gap;
    }

    function rule(shade) {
      ensure(12);
      doc.setDrawColor(shade);
      doc.line(left, y, right, y);
      y += 16;
    }

    // Items are text, or { text, url } for a link.
    function bullets(items) {
      items.forEach(function (item) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(60);
        if (item && item.url) {
          ensure(16);
          doc.text("\u2022", left, y);
          doc.setTextColor(36, 69, 214);
          doc.textWithLink(safe(item.text), left + 14, y, { url: item.url });
          doc.setDrawColor(36, 69, 214);
          doc.line(left + 14, y + 2, left + 14 + doc.getTextWidth(safe(item.text)), y + 2);
          y += 16;
          return;
        }
        var lines = doc.splitTextToSize(safe(item), width - 14);
        lines.forEach(function (line, i) {
          ensure(13);
          if (i === 0) doc.text("\u2022", left, y);
          doc.text(line, left + 14, y);
          y += 13;
        });
        y += 3;
      });
    }

    // The floor plan, scaled to fit the page width and maxHeight points.
    function drawPlan(plan, maxHeight) {
      var b = { x0: 0, z0: 0, x1: plan.w, z1: plan.l };
      var grow = function (x, z) {
        b.x0 = Math.min(b.x0, x);
        b.x1 = Math.max(b.x1, x);
        b.z0 = Math.min(b.z0, z);
        b.z1 = Math.max(b.z1, z);
      };
      (plan.rects || []).forEach(function (r) {
        grow(r.x0, r.z0);
        grow(r.x1, r.z1);
      });
      (plan.texts || []).forEach(function (t) {
        grow(t.x - 0.6, t.z - 0.6);
        grow(t.x + 0.6, t.z + 0.6);
      });
      var scale = Math.min(width / (b.x1 - b.x0), maxHeight / (b.z1 - b.z0));
      var drawnW = (b.x1 - b.x0) * scale;
      var drawnH = (b.z1 - b.z0) * scale;
      ensure(drawnH + 8);
      var ox = left + (width - drawnW) / 2 - b.x0 * scale;
      var oy = y - b.z0 * scale;
      var X = function (x) {
        return ox + x * scale;
      };
      var Y = function (z) {
        return oy + z * scale;
      };
      doc.setLineWidth(0.8);
      (plan.rects || []).forEach(function (r) {
        var mode = r.fill && r.stroke ? "FD" : r.fill ? "F" : "S";
        if (r.fill) doc.setFillColor(r.fill[0], r.fill[1], r.fill[2]);
        if (r.stroke) doc.setDrawColor(r.stroke[0], r.stroke[1], r.stroke[2]);
        doc.rect(X(r.x0), Y(r.z0), (r.x1 - r.x0) * scale, (r.z1 - r.z0) * scale, mode);
      });
      doc.setDrawColor(90, 100, 125);
      doc.setLineWidth(0.6);
      (plan.arcs || []).forEach(function (a) {
        var steps = 18;
        var prev = null;
        for (var i = 0; i <= steps; i++) {
          var t = (Math.PI / 2) * (i / steps);
          var px = a.x + a.r * (Math.cos(t) * a.ax + Math.sin(t) * a.bx);
          var pz = a.z + a.r * (Math.cos(t) * a.az + Math.sin(t) * a.bz);
          if (prev) doc.line(X(prev.x), Y(prev.z), X(px), Y(pz));
          prev = { x: px, z: pz };
        }
      });
      doc.setLineWidth(1.4);
      (plan.lines || []).forEach(function (l) {
        doc.line(X(l.x0), Y(l.z0), X(l.x1), Y(l.z1));
      });
      doc.setLineWidth(0.8);
      (plan.texts || []).forEach(function (t) {
        var size = t.small ? 7.5 : t.bold ? 11 : 9;
        doc.setFont("helvetica", t.bold ? "bold" : "normal");
        doc.setFontSize(size);
        doc.setTextColor(t.bold ? 20 : 40);
        var text = safe(t.text);
        if (t.vertical) {
          doc.text(text, X(t.x) + size * 0.35, Y(t.z) + doc.getTextWidth(text) / 2, { angle: 90 });
        } else {
          var lines = t.small ? doc.splitTextToSize(text, 80).slice(0, 2) : [text];
          lines.forEach(function (line, i) {
            var baseline = Y(t.z) + size * 0.35 + (i - (lines.length - 1) / 2) * size * 1.1;
            if (t.halo) {
              var w = doc.getTextWidth(line) + 4;
              doc.setFillColor(t.halo[0], t.halo[1], t.halo[2]);
              doc.rect(X(t.x) - w / 2, baseline - size * 0.8, w, size * 1.05, "F");
            }
            doc.text(line, X(t.x), baseline, { align: "center" });
          });
        }
      });
      y += drawnH + 14;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(20);
    doc.text(safe(spec.heading || (spec.footer && spec.footer.businessName) || ""), left, y);
    y += 22;
    paragraph(spec.title, 13, 80, "normal", 2);
    if (spec.preparedFor) paragraph(T("pdf.preparedFor", { name: spec.preparedFor }), 11, 60, "normal", 2);
    y += 4;
    rule(200);
    if (spec.intro) paragraph(spec.intro, 11, 60, "italic", 10);

    if (spec.picture) {
      var picture = doc.getImageProperties(spec.picture);
      var picHeight = Math.min((width * picture.height) / picture.width, 300);
      var picWidth = (picHeight * picture.width) / picture.height;
      ensure(picHeight + 12);
      doc.addImage(spec.picture, "JPEG", left + (width - picWidth) / 2, y, picWidth, picHeight);
      y += picHeight + 18;
    }
    if (spec.plan) {
      paragraph(spec.planTitle || "", 11, 30, "bold", 6);
      drawPlan(spec.plan, 230);
    }
    if (spec.design && spec.design.length) {
      ensure(40);
      paragraph(spec.designTitle || "", 11, 30, "bold", 2);
      bullets(spec.design);
      y += 6;
      if (spec.lines && spec.lines.length) rule(210);
    }

    // Line items: label | quantity x rate | amount, under their heading.
    var labelWidth = 170;
    var detailX = left + labelWidth + 10;
    var detailWidth = right - 90 - detailX;
    if (spec.linesTitle && spec.lines && spec.lines.length) {
      ensure(60);
      paragraph(spec.linesTitle, 11, 30, "bold", 6);
    }
    (spec.lines || []).forEach(function (l) {
      doc.setFontSize(11);
      var labelLines = doc.splitTextToSize(safe(l.label), labelWidth);
      doc.setFontSize(10);
      var detailLines = doc.splitTextToSize(safe(l.detail), detailWidth);
      var rowHeight = Math.max(labelLines.length * 14, detailLines.length * 13) + 6;
      ensure(rowHeight);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(30);
      doc.text(labelLines, left, y);
      doc.text(safe(l.amount), right, y, { align: "right" });
      doc.setFontSize(10);
      doc.setTextColor(95);
      doc.text(detailLines, detailX, y);
      y += rowHeight;
    });

    if (spec.excluded && spec.excluded.length) {
      y += 2;
      spec.excluded.forEach(function (x) {
        doc.setFontSize(10);
        var labelLines = doc.splitTextToSize(safe(x.label), width - 150);
        ensure(labelLines.length * 13 + 4);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(80);
        doc.text(labelLines, left, y);
        doc.text(safe(x.value), right, y, { align: "right" });
        y += labelLines.length * 13 + 4;
      });
    }

    // The rule and the totals move to a new page together, never the
    // total alone: it belongs with the lines above it.
    var totalsHeight = 4 + 16;
    (spec.totals || []).forEach(function (t) {
      var size = t.strong ? 15 : 11;
      doc.setFontSize(size);
      totalsHeight += doc.splitTextToSize(safe(t.label), width - 150).length * (size + 4) + 4;
    });
    ensure(totalsHeight);
    y += 4;
    rule(210);
    (spec.totals || []).forEach(function (t) {
      var size = t.strong ? 15 : 11;
      doc.setFontSize(size);
      var labelLines = doc.splitTextToSize(safe(t.label), width - 150);
      doc.setFont("helvetica", t.strong ? "bold" : "normal");
      doc.setTextColor(20);
      doc.text(labelLines, left, y);
      doc.text(safe(t.value), right, y, { align: "right" });
      y += labelLines.length * (size + 4) + 4;
    });
    y += 6;

    (spec.afterTotal || []).forEach(function (text) {
      paragraph(text, 10, 60, "normal", 6);
    });

    (spec.sections || []).forEach(function (section) {
      y += 6;
      ensure(40);
      paragraph(section.title, 11, 30, "bold", 2);
      bullets(section.items);
    });

    var total = doc.getNumberOfPages();
    var f = spec.footer || {};
    for (var i = 1; i <= total; i++) {
      doc.setPage(i);
      doc.setDrawColor(220);
      doc.line(left, pageHeight - 52, right, pageHeight - 52);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(90);
      var contact = [T("pdf.generated", { date: f.date }), f.phone, f.email].filter(Boolean).join("  \u2022  ");
      doc.text(safe(contact), left, pageHeight - 38);
      doc.text(T("pdf.page", { i: i, n: total }), right, pageHeight - 38, { align: "right" });
      doc.text(doc.splitTextToSize(safe(f.business || f.businessName || ""), width)[0], left, pageHeight - 26);
    }
    return doc;
  }

  window.EstimatePdf = { load: load, build: build };
})();
