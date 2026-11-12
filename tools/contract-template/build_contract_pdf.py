#!/usr/bin/env python3
"""Builds StormShield_Contract.pdf — the fillable Contract Confirmation template
(page 1: work order, specs, payment, authorization; page 2: terms & conditions).

The CRM fills the AcroForm fields by name (crm-contract.js), draws the homeowner's
initials / signatures on the "spot" fields, then flattens the form. Field names must
stay in sync with crm-contract.js.

Run from the repo root:  python3 tools/contract-template/build_contract_pdf.py
"""
import json, os
from reportlab.lib.colors import Color, HexColor, white
from reportlab.lib.pagesizes import legal
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'StormShield_Contract.pdf')
LOGO = os.path.join(HERE, 'logo.png')
TERMS = json.load(open(os.path.join(HERE, 'terms.json')))

W, H = legal                      # 612 x 1008
M = 36                            # page margin
NAVY = HexColor('#0F1E3A')
INK = HexColor('#141A26')
GREY = HexColor('#757D8D')
LINE = HexColor('#8A94A8')
FILL = HexColor('#EEF3FC')        # field background
RULE = HexColor('#253A54')
VERSION = 'SSPR – Contract Confirmation · ver. 11/2026'

c = canvas.Canvas(OUT, pagesize=legal)
c.setTitle('StormShield Pro Roofing – Contract Confirmation')
c.setAuthor('StormShield Pro Roofing')
form = c.acroForm


# ----------------------------------------------------------------- primitives
def text(x, y, s, size=9, bold=False, color=INK, align='left'):
    c.setFont('Helvetica-Bold' if bold else 'Helvetica', size)
    c.setFillColor(color)
    if align == 'right':
        c.drawRightString(x, y, s)
    elif align == 'center':
        c.drawCentredString(x, y, s)
    else:
        c.drawString(x, y, s)


def spaced(x, y, s, size, color, tracking=2.2):
    c.setFont('Helvetica-Bold', size)
    c.setFillColor(color)
    for ch in s:
        c.drawString(x, y, ch)
        x += stringWidth(ch, 'Helvetica-Bold', size) + tracking


def wrap(s, width, size, bold=False):
    font = 'Helvetica-Bold' if bold else 'Helvetica'
    words, lines, cur = s.split(' '), [], ''
    for w in words:
        nxt = (cur + ' ' + w).strip()
        if stringWidth(nxt, font, size) > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = nxt
    if cur:
        lines.append(cur)
    return lines


def para(x, y, s, width, size=7.6, leading=None, bold_lead='', color=INK):
    """Paragraph with an optional bold lead-in. Returns the y below the last line."""
    leading = leading or size * 1.3
    font_b, font_r = 'Helvetica-Bold', 'Helvetica'
    # tokens: (word, bold)
    toks = [(w, True) for w in bold_lead.split(' ') if w] + [(w, False) for w in s.split(' ') if w]
    lines, cur, cw = [], [], 0
    sp = stringWidth(' ', font_r, size)
    for w, b in toks:
        ww = stringWidth(w, font_b if b else font_r, size)
        if cur and cw + sp + ww > width:
            lines.append(cur)
            cur, cw = [(w, b)], ww
        else:
            cw += (sp if cur else 0) + ww
            cur.append((w, b))
    if cur:
        lines.append(cur)
    for ln in lines:
        xx = x
        for w, b in ln:
            f = font_b if b else font_r
            c.setFont(f, size)
            c.setFillColor(color)
            c.drawString(xx, y, w)
            xx += stringWidth(w, f, size) + sp
        y -= leading
    return y


def field(name, x, y, w, h=12.5, size=8.5, fill=True):
    """Text field. (x, y) is the bottom-left corner."""
    form.textfield(name=name, x=x, y=y, width=w, height=h, borderWidth=0,
                   fillColor=FILL if fill else None, textColor=INK, fontName='Helvetica',
                   fontSize=size, forceBorder=False, relative=False)


def labelled(label, name, x, y, w, lw=None, size=8.5, bold=False):
    """'Label ▭' on one row. Returns nothing; row height is 16."""
    lw = lw if lw is not None else stringWidth(label, 'Helvetica-Bold' if bold else 'Helvetica', size) + 4
    text(x, y + 2.5, label, size, bold=bold)
    field(name, x + lw, y, w - lw)


def check(name, x, y, label, size=7.8, boxs=7.6, lx=None):
    """Checkbox with a label to its right. (x, y) is the baseline of the row."""
    form.checkbox(name=name, x=x, y=y - 1.2, size=boxs, buttonStyle='check', borderWidth=0.8,
                  borderColor=LINE, fillColor=white, textColor=INK, forceBorder=True, relative=False)
    text((lx if lx is not None else x + boxs + 3.5), y, label, size)


def spot(name, x, y, w, h):
    """Invisible field whose rectangle tells the CRM where ink / auto-text goes."""
    form.textfield(name=name, x=x, y=y, width=w, height=h, borderWidth=0, fillColor=None,
                   textColor=INK, fontName='Helvetica', fontSize=9, forceBorder=False, relative=False)


def sigline(x, y, w, label):
    c.setStrokeColor(INK)
    c.setLineWidth(0.6)
    c.line(x, y, x + w, y)
    text(x, y - 8, label, 6.6, color=GREY)


def section(y, title, right=None):
    text(M, y, title, 10, bold=True, color=NAVY)
    if right:
        text(W - M, y, right, 7, color=GREY, align='right')
    c.setStrokeColor(NAVY)
    c.setLineWidth(1)
    c.line(M, y - 4, W - M, y - 4)
    return y - 16


def header(title, subtitle, page_no):
    top = H - M
    c.drawImage(LOGO, M, top - 72, width=78, height=72, mask='auto')
    spaced(M + 92, top - 24, 'STORM DAMAGE EXPERTS', 7.6, GREY, 2.4)
    text(M + 92, top - 40, '12111 Forest Sage Ln, Pearland, TX 77584', 8.6)
    text(M + 92, top - 53, '832-910-7735   ·   stormshieldproroofing.com', 8.6)
    text(W - M, top - 28, title, 17, bold=True, color=NAVY, align='right')
    text(W - M, top - 48, subtitle, 7.2, bold=True, color=GREY, align='right')
    c.setStrokeColor(NAVY)
    c.setLineWidth(2.4)
    c.line(M, top - 82, W - M, top - 82)
    # footer
    text(M, 22, VERSION, 6.6, color=GREY)
    text(W - M, 22, page_no, 6.6, color=GREY, align='right')
    return top - 96


# ================================================================= PAGE 1
y = header('CONTRACT CONFIRMATION', 'MASTER RESTORATION AGREEMENT  ·  PAGE 1 OF 2', 'Page 1 of 2')

# ---- customer & project information
y = section(y, 'CUSTOMER & PROJECT INFORMATION')
colw = (W - 2 * M - 18) / 2
lx, rx = M, M + colw + 18
rows = [('Customer', 'customer', 'Cell #', 'cell'),
        ('Street address', 'street', 'Representative', 'rep'),
        ('City / State / Zip', 'citystatezip', 'Contract date', 'contract_date'),
        ('Email', 'email', 'Build date', 'build_date')]
for la, na, lb, nb in rows:
    labelled(la, na, lx, y - 4, colw, lw=76)
    labelled(lb, nb, rx, y - 4, colw, lw=76)
    y -= 16.5
y -= 8

# ---- material & specifications
y = section(y, 'MATERIAL & SPECIFICATIONS')
RH = 11.0                       # checkbox row height
gap = 12
cw4 = (W - 2 * M - 3 * gap) / 4
cx = [M + i * (cw4 + gap) for i in range(4)]


def colhead(x, y, s):
    text(x, y, s, 7.6, bold=True, color=NAVY)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.4)
    c.line(x, y - 3, x + cw4, y - 3)
    return y - 12.5


def checks(x, y, items):
    for name, label in items:
        check(name, x, y, label)
        y -= RH
    return y


def check_other(name, tname, x, y, label='Other', fw=None):
    check(name, x, y, label)
    lw = stringWidth(label, 'Helvetica', 7.8) + 15
    field(tname, x + lw, y - 3, (fw or cw4) - lw, h=11, size=8)
    return y - RH


# row A: shingles | tamko | colors | start strip
yA = y
ya = colhead(cx[0], yA, 'SHINGLES')
ya = checks(cx[0], ya, [('shingles_certainteed_1', 'CertainTeed'), ('shingles_certainteed_2', 'Landmark'),
                        ('shingles_certainteed_3', 'Landmark Pro'), ('shingles_certainteed_4', 'Landmark Climate Flex'),
                        ('shingles_certainteed_5', 'Presidential Shake'), ('shingles_certainteed_6', 'Presidential Shake TL'),
                        ('shingles_certainteed_7', 'Carriage House'), ('shingles_certainteed_8', 'Belmont'),
                        ('shingles_certainteed_9', 'Grand Manor'), ('shingles_certainteed_10', 'Solaris')])
yb = colhead(cx[1], yA, 'TAMKO')
yb = checks(cx[1], yb, [('shingles_tamko_1', 'Tamko'), ('shingles_tamko_2', 'Heritage'), ('shingles_tamko_3', 'Titan XT'),
                        ('shingles_tamko_4', 'StormFighter FLEX'), ('shingles_tamko_5', 'HailGuard')])
yb = check_other('shingles_tamko_6', 'shingles_other', cx[1], yb)
yc = colhead(cx[2], yA, 'COLORS')
yc = checks(cx[2], yc, [('colors_1', 'Burnt Sienna / Rustic Hickory'), ('colors_2', 'Georgetown / Oxford Gray'),
                        ('colors_3', 'Cobblestone Gray / Antique Slate'), ('colors_4', 'Thunderstorm Gray'),
                        ('colors_5', 'Espresso / Black Walnut'), ('colors_6', 'Heather Blend / Natural Timber'),
                        ('colors_7', 'Moire Black / Rustic Black'), ('colors_8', 'Silver Birch / Old English Pewter'),
                        ('colors_9', 'Resawn Shake / Rustic Cedar'), ('colors_10', 'Weathered Wood')])
yc = check_other('colors_11', 'color_other', cx[2], yc)
yd = colhead(cx[3], yA, 'START STRIP')
yd = checks(cx[3], yd, [('start_strip_1', 'Swift Start'), ('start_strip_2', 'Tamko Starter Strip')])
yd = check_other('start_strip_3', 'start_strip_other', cx[3], yd)
yd -= 4
yd = colhead(cx[3], yd, 'DRIP EDGE')
yd = checks(cx[3], yd, [('drip_edge_1', 'Use existing')])
yd = check_other('drip_edge_2', 'drip_edge_size', cx[3], yd, 'Pre-finished edge, size')
text(cx[3], yd, 'Color (check one)', 7.2, color=GREY)
yd -= RH
half = cw4 / 2
check('de_color_black', cx[3], yd, 'Black'); check('de_color_white', cx[3] + half, yd, 'White'); yd -= RH
check('de_color_brown', cx[3], yd, 'Brown'); check('de_color_almond', cx[3] + half, yd, 'Almond'); yd -= RH
check('de_color_bronze', cx[3], yd, 'Bronze'); check('de_color_gray', cx[3] + half, yd, 'Gray'); yd -= RH
check('de_color_tan', cx[3], yd, 'Tan'); yd -= RH
y = min(ya, yb, yc, yd) - 4

# row B: underlayment | ridge | valley | ventilation (static/turbine/color)
yB = y
ya = colhead(cx[0], yB, 'UNDERLAYMENT')
ya = checks(cx[0], ya, [('underlayment_1', 'Roof Runner'), ('underlayment_2', 'Synthetic'), ('underlayment_3', 'Radiant Barrier')])
ya = check_other('underlayment_4', 'underlayment_other', cx[0], ya)
yb = colhead(cx[1], yB, 'RIDGE')
yb = checks(cx[1], yb, [('ridge_1', 'Shadow Ridge'), ('ridge_2', 'Cedar Crest'), ('ridge_3', 'Tamko Heritage'),
                        ('ridge_4', 'Tamko Heritage Designer'), ('ridge_5', 'Tamko Proline')])
yb = check_other('ridge_6', 'ridge_other', cx[1], yb)
yc = colhead(cx[2], yB, 'VALLEY')
yc = checks(cx[2], yc, [('valley_1', 'Ice & Water Shield'), ('valley_2', '"W" Metal'), ('valley_3', 'Valley Metal')])
yc = check_other('valley_4', 'valley_other', cx[2], yc)
yd = colhead(cx[3], yB, 'DECKING')
yd = checks(cx[3], yd, [('decking_1', 'OSB'), ('decking_2', 'Plywood'), ('decking_3', 'Radiant Barrier')])
yd = check_other('decking_4', 'decking_other', cx[3], yd)
y = min(ya, yb, yc, yd) - 4

# row C: ventilation (two columns) | plumbing stacks
yC = y


def check_qty(name, qname, x, y, label, unit, qw=34):
    check(name, x, y, label)
    lw = stringWidth(label, 'Helvetica', 7.8) + 15
    field(qname, x + lw, y - 3, qw, h=11, size=8)
    text(x + lw + qw + 3, y, unit, 7.2, color=GREY)
    return y - RH


ya = colhead(cx[0], yC, 'VENTILATION')
ya = check_qty('vent_left_1', 'vent_ridge_lf', cx[0], ya, 'Ridge vent', 'LF')
ya = check_qty('vent_left_2', 'vent_power_qty', cx[0], ya, 'Power vents', 'qty')
ya = check_qty('vent_left_3', 'vent_solar_qty', cx[0], ya, 'Solar vents', 'qty')
yb = colhead(cx[1], yC, ' ')
yb = check_qty('vent_right_1', 'vent_static_qty', cx[1], yb, 'Static', 'qty')
yb = check_qty('vent_right_2', 'vent_turbine_qty', cx[1], yb, 'Turbine', 'qty')
yb = check_qty('vent_right_3', 'vent_color_qty', cx[1], yb, 'Color', '', qw=60)
yc = colhead(cx[2], yC, 'PLUMBING STACKS')
yc = check_qty('plumbing_1', 'plumbing_3in1_qty', cx[2], yc, '3-in-1', 'qty')
yc = check_qty('plumbing_2', 'plumbing_1_5_lead_qty', cx[2], yc, '1-1/2" lead', 'qty')
yd = colhead(cx[3], yC, ' ')
yd = check_qty('plumbing_3', 'plumbing_2_lead_qty', cx[3], yd, '2" lead', 'qty')
yd = check_qty('plumbing_4', 'plumbing_3_lead_qty', cx[3], yd, '3" lead', 'qty')
y = min(ya, yb, yc, yd) - 7

# ---- additional items
y = section(y, 'ADDITIONAL ITEMS')
for i in range(4):
    for col, n in ((0, i + 1), (1, i + 5)):
        xx = M + col * (colw + 18)
        text(xx, y - 1, '%d.' % n, 8, color=GREY)
        field('addl_%d' % n, xx + 14, y - 4, colw - 14, h=12, size=8.2)
    y -= 14.5
y -= 6

# ---- warranty
y = section(y, 'WARRANTY')
wy = y - 2
check('warranty_standard', M, wy, 'Standard')
check('warranty_3star', M + 92, wy, '3-Star (20-year non-prorated)')
check('warranty_4star', M + 236, wy, '4-Star (50-year non-prorated)')
check('warranty_5star', M + 380, wy, '5-Star')
wy -= RH + 1
check('warranty_lifetime', M, wy, 'Lifetime Workmanship Warranty')
check('warranty_class3', M + 180, wy, 'Class 3 Impact Resistance  +  160 mph wind  +  10-year algae warranty')
y = wy - 16

# ---- payment schedule
y = section(y, 'PAYMENT SCHEDULE IS AS FOLLOWS')
py = y - 3
pw = 270
for label, name in (('Replacement Cost Value (RCV) total charge', 'rcv'), ('Net claim amount due', 'net_claim'),
                    ('Deductible amount due', 'deductible'), ('Depreciation amount due', 'depreciation')):
    text(M, py + 2.5, label, 8, bold=(name == 'rcv'))
    text(M + 178, py + 2.5, '$', 8.5, bold=True)
    field(name, M + 186, py, 84, size=8.8)
    py -= 16
bx = M + pw + 24
c.setFillColor(FILL)
c.roundRect(bx, py + 4, W - M - bx, y - py - 6, 4, stroke=0, fill=1)
text(bx + 10, y - 12, 'Ask your StormShield representative about our Review Rebate.', 7.6, bold=True)
check('review_submitted', bx + 10, y - 27, 'All reviews have been submitted', 7.6)
text(bx + 10, y - 44, 'PLEASE MAKE CHECKS PAYABLE TO:', 7, bold=True, color=GREY)
text(bx + 10, y - 55, 'STORMSHIELD PRO ROOFING', 8.6, bold=True, color=NAVY)
y = py + 2

# ---- insurance pricing + supplements
y = para(M, y, 'Due to the unique nature of repairs to insurance claims, this contract does not include an explicit '
         'price because the final scope has not been agreed upon with the insurer. Reaching an agreement on the full '
         'scope of repairs involves considerable time on StormShield Pro Roofing & Construction’s part; we will not '
         'proceed with this phase unless you agree to allow us to do the work once the scope is agreed upon. By signing '
         'this agreement, you authorize StormShield Pro Roofing & Construction to reach an agreement on the price and '
         'scope of repairs on your behalf. StormShield Pro Roofing & Construction agrees to bid the work using the '
         'primary insurance industry pricing database (Xactimate) based on the scope of work agreed upon with your '
         'insurer, including general contractor markup at customary insurance industry rates (10% overhead, 10% profit '
         'on Xactimate line items). Any substantial additions or deductions to the scope of the work will be handled by '
         'written construction change orders.', W - 2 * M, size=7.3, leading=9.0)
y -= 3
# supplements paragraph with the initials box on the left
ibw, ibh = 62, 24
c.setFillColor(FILL)
c.rect(M, y - ibh + 2, ibw, ibh, stroke=0, fill=1)
c.setStrokeColor(INK)
c.setLineWidth(0.6)
c.line(M, y - ibh + 2, M + ibw, y - ibh + 2)
text(M + ibw / 2, y - ibh - 6, 'Customer initials', 6.4, color=GREY, align='center')
spot('initials_supplements', M, y - ibh + 2, ibw, ibh)
y2 = para(M + ibw + 10, y, 'Potential supplements include, but are not limited to: re-deck, building permit, '
          'additional ventilation, ridge cap, overhead and profit, and additional material. You understand that these '
          'supplemental items may be required by your local building official. By initialing here you agree to allow '
          'StormShield Pro Roofing & Construction to supplement your insurance carrier for the additional funds these '
          'items require, and that those supplemental funds are payable to StormShield Pro Roofing & Construction.',
          W - 2 * M - ibw - 10, size=7.3, leading=9.0,
          bold_lead='SOMETIMES SUPPLEMENTS ARE REQUIRED ON YOUR JOB IN ORDER TO COMPLETE THE WORK.')
y = min(y2, y - ibh - 10) - 8

# ---- authorized by
y = section(y, 'AUTHORIZED BY')
y = para(M, y, 'By executing this two-page Master Restoration Agreement, the customer acknowledges comprehensive receipt, '
         'review, and unconditional acceptance of both the primary work order specifications, notes and financial '
         'allocations (page 1) and the Terms & Conditions (page 2).', W - 2 * M, size=7.3, leading=9.0)
sy = y - 18
sw = 300
sigline(M, sy, sw, 'AUTHORIZED HOMEOWNER SIGNATURE')
spot('sig_homeowner', M, sy + 1, sw, 30)
sigline(M + sw + 30, sy, W - M - (M + sw + 30), 'DATE')
field('homeowner_date', M + sw + 30, sy + 2, 120, h=12, size=9, fill=False)
y = sy - 24
y = para(M, y, 'We hereby agree to furnish labor and materials complete in accordance with the above specifications and in '
         'conjunction with the original contract at the above stated price. Please make all checks payable to '
         'StormShield Pro Roofing. StormShield Pro Roofing & Construction will not be responsible for checks made payable '
         'to any other party.', W - 2 * M, size=7.3, leading=9.0)
sy = y - 18
sigline(M, sy, sw, 'STORMSHIELD PRO ROOFING & CONSTRUCTION REPRESENTATIVE')
spot('sig_rep', M, sy + 1, sw, 30)
sigline(M + sw + 30, sy, W - M - (M + sw + 30), 'DATE')
field('rep_date', M + sw + 30, sy + 2, 120, h=12, size=9, fill=False)
print('page 1 bottom y =', round(sy - 10, 1))
c.showPage()

# ================================================================= PAGE 2
form = c.acroForm
y = header('TERMS & CONDITIONS', 'MASTER CONTRACT TERMS  ·  LEGAL ADDENDUM RIDERS  ·  PAGE 2 OF 2', 'Page 2 of 2')
y = section(y, 'STORMSHIELD PRO ROOFING & CONSTRUCTION — MASTER CONTRACT TERMS & CONDITIONS')
cgap = 18
tcw = (W - 2 * M - cgap) / 2
size, lead = 7.8, 10.2
# balance the two columns by measuring
blocks = []
for i, (head, body) in enumerate(TERMS):
    lines = []
    toks = ('%d. %s:' % (i + 1, head), body)
    blocks.append(toks)


def measure(head, body):
    # same wrapping as para(); count lines
    toks = [(w, True) for w in head.split(' ')] + [(w, False) for w in body.split(' ')]
    n, cw, cur = 1, 0, False
    sp = stringWidth(' ', 'Helvetica', size)
    for w, b in toks:
        ww = stringWidth(w, 'Helvetica-Bold' if b else 'Helvetica', size)
        if cur and cw + sp + ww > tcw:
            n += 1
            cw = ww
        else:
            cw += (sp if cur else 0) + ww
            cur = True
    return n * lead + 6


heights = [measure(h, b) for h, b in blocks]
total = sum(heights)
split, acc = len(blocks), 0
for i, hh in enumerate(heights):
    acc += hh
    if acc >= total / 2:
        split = i + 1
        break
top = y
for col, rng in ((0, range(0, split)), (1, range(split, len(blocks)))):
    yy = top
    xx = M + col * (tcw + cgap)
    for i in rng:
        head, body = blocks[i]
        yy = para(xx, yy, body, tcw, size=size, leading=lead, bold_lead=head) - 6
    if col == 0:
        bottom0 = yy
    else:
        bottom1 = yy
y = min(bottom0, bottom1) - 8

# acknowledgement + initials at the foot of the terms
c.setStrokeColor(NAVY)
c.setLineWidth(0.8)
c.line(M, y, W - M, y)
y -= 20
c.setFillColor(FILL)
c.rect(M, y - 14, ibw, ibh, stroke=0, fill=1)
c.setStrokeColor(INK)
c.setLineWidth(0.6)
c.line(M, y - 14, M + ibw, y - 14)
text(M + ibw / 2, y - 22, 'Customer initials', 6.4, color=GREY, align='center')
spot('initials_terms', M, y - 14, ibw, ibh)
para(M + ibw + 12, y + 2, 'I have read and understand these Terms & Conditions, which are part of my StormShield Pro '
     'Roofing & Construction contract.', W - 2 * M - ibw - 12, size=8, leading=10.5, bold_lead='Acknowledgement.')
print('page 2 bottom y =', round(y - 22, 1))
c.showPage()
c.save()
print('wrote', os.path.normpath(OUT))
