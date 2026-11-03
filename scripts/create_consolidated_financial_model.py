from copy import copy
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "Dashboard-financiero-VIA-2026-10-21-infraestructura.xlsx"
TARGET = ROOT / "docs" / "Dashboard-financiero-VIA-2026-10-21-consolidado.xlsx"

BLUE = "0000FF"
GREEN = "008000"
BLACK = "000000"
NAVY = "1F4E78"
YELLOW = "FFFF00"
PALE_YELLOW = "FFF2CC"
PALE_BLUE = "D9EAF7"
PALE_GREEN = "E2F0D9"
PALE_RED = "FCE4D6"
WHITE = "FFFFFF"
GRAY = "F2F2F2"
THIN_GRAY = Side(style="thin", color="D9E1F2")


def style_title(ws, cell, text, width=13):
    ws.merge_cells(start_row=cell.row, start_column=cell.column, end_row=cell.row, end_column=width)
    cell.value = text
    cell.font = Font(name="Arial", size=16, bold=True, color=WHITE)
    cell.fill = PatternFill("solid", fgColor=NAVY)
    cell.alignment = Alignment(vertical="center")
    ws.row_dimensions[cell.row].height = 28


def style_subtitle(ws, row, text, width=13):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=width)
    cell = ws.cell(row, 1, text)
    cell.font = Font(name="Arial", size=10, italic=True, color="595959")
    cell.alignment = Alignment(wrap_text=True, vertical="center")
    ws.row_dimensions[row].height = 30


def style_section(ws, row, text, width=13):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=width)
    cell = ws.cell(row, 1, text)
    cell.font = Font(name="Arial", size=11, bold=True, color=WHITE)
    cell.fill = PatternFill("solid", fgColor="5B9BD5")
    cell.alignment = Alignment(vertical="center")


def set_header(ws, row, values):
    for col, value in enumerate(values, 1):
        cell = ws.cell(row, col, value)
        cell.font = Font(name="Arial", bold=True, color=WHITE)
        cell.fill = PatternFill("solid", fgColor=NAVY)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = Border(bottom=THIN_GRAY)
    ws.row_dimensions[row].height = 32


def set_cell(cell, value=None, kind="formula", fill=None, num_format=None, comment=None):
    if value is not None:
        cell.value = value
    color = {"input": BLUE, "link": GREEN, "formula": BLACK, "label": BLACK}[kind]
    cell.font = Font(name="Arial", size=10, color=color)
    cell.alignment = Alignment(vertical="center", wrap_text=True)
    cell.border = Border(bottom=THIN_GRAY)
    if fill:
        cell.fill = PatternFill("solid", fgColor=fill)
    if num_format:
        cell.number_format = num_format
    if comment:
        cell.comment = Comment(comment, "Codex")


def formula_link(cell, formula, num_format=None):
    set_cell(cell, formula, kind="link", num_format=num_format)


def formula(cell, value, num_format=None):
    set_cell(cell, value, kind="formula", num_format=num_format)


def apply_font(ws):
    for row in ws.iter_rows():
        for cell in row:
            if cell.value is not None and cell.font.name != "Arial":
                cell.font = copy(cell.font)
                cell.font = Font(
                    name="Arial",
                    size=cell.font.sz or 10,
                    bold=cell.font.bold,
                    italic=cell.font.italic,
                    underline=cell.font.underline,
                    color=cell.font.color,
                )


def create_model_sheet(wb):
    if "Modelo consolidado" in wb.sheetnames:
        del wb["Modelo consolidado"]
    ws = wb.create_sheet("Modelo consolidado", 1)
    ws.sheet_view.showGridLines = False
    for col, width in {"A": 32, "B": 18, "C": 18, "D": 16, "E": 18, "F": 20, "G": 20, "H": 21, "I": 18, "J": 18, "K": 18, "L": 18, "M": 24}.items():
        ws.column_dimensions[col].width = width

    style_title(ws, ws.cell(1, 1), "VIA | Modelo financiero consolidado", 13)
    style_subtitle(
        ws,
        2,
        "Usa los seis planes de VIA. Las celdas amarillas con texto azul son entradas. La mezcla inicial es 100% Pro (COP 99.000); modifícala cuando exista evidencia comercial por plan.",
        13,
    )

    style_section(ws, 4, "Entradas de modelo y fuentes", 13)
    inputs = [
        ("Provisión adicional sobre costos VIA", 0.10, "0.0%", "Reserva prudencial solicitada para costos operativos y comerciales."),
        ("Comisión Mercado Pago inmediata", 0.0329, "0.00%", "Tarifa pública de suscripciones Colombia; validar contra la liquidación real del comercio."),
        ("Fijo Mercado Pago por cobro", 800, 'COP #,##0;[Red](COP #,##0);-', "Cargo fijo publicado por cobro exitoso."),
        ("IVA sobre comisión Mercado Pago", 0.19, "0.0%", "IVA aplicado al componente de comisión de Mercado Pago."),
        ("Costo histórico para separar presupuesto legado", 19000, 'COP #,##0;[Red](COP #,##0);-', "Solo descompone el presupuesto histórico del caso de negocio. No es el costo técnico actual y no participa como tal en el modelo nuevo."),
    ]
    for row, (label, value, fmt, note) in enumerate(inputs, 5):
        set_cell(ws.cell(row, 1), label, kind="label", fill=GRAY)
        set_cell(ws.cell(row, 2), value, kind="input", fill=YELLOW, num_format=fmt, comment=note)
        set_cell(ws.cell(row, 3), note, kind="label")
        ws.merge_cells(start_row=row, start_column=3, end_row=row, end_column=13)

    style_section(ws, 12, "Mezcla comercial por plan", 13)
    headers = [
        "Plan", "Domicilios incluidos", "Precio mensual VIA", "Mix de clientes", "Domicilios ponderados", "Ingreso ponderado", "Mercado Pago ponderado", "Reserva DeepSeek ponderada", "Meta tenant estimado", "Mix acumulado", "Observación"
    ]
    set_header(ws, 13, headers)
    plan_rows = range(5, 11)
    mix = [0, 0, 0, 1, 0, 0]
    for out_row, (plan_row, initial_mix) in enumerate(zip(plan_rows, mix), 14):
        formula_link(ws.cell(out_row, 1), f"=Planes!A{plan_row}")
        formula_link(ws.cell(out_row, 2), f"=Planes!B{plan_row}", '#,##0;[Red](#,##0);-')
        formula_link(ws.cell(out_row, 3), f"=Planes!C{plan_row}", 'COP #,##0;[Red](COP #,##0);-')
        set_cell(ws.cell(out_row, 4), initial_mix, kind="input", fill=YELLOW, num_format="0.0%", comment="Distribución esperada de clientes activos por plan. Debe sumar 100%.")
        formula(ws.cell(out_row, 5), f"=B{out_row}*D{out_row}", '#,##0.0;[Red](#,##0.0);-')
        formula(ws.cell(out_row, 6), f"=C{out_row}*D{out_row}", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(out_row, 7), f"=((C{out_row}*$B$6+$B$7)*(1+$B$8))*D{out_row}", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(out_row, 8), f"=Planes!F{plan_row}*D{out_row}", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(out_row, 9), f"=Planes!I{plan_row}*D{out_row}", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(out_row, 10), f"=SUM($D$14:D{out_row})", "0.0%")
        set_cell(ws.cell(out_row, 11), "Meta es facturado directamente al tenant.", kind="label")

    total_row = 20
    set_cell(ws.cell(total_row, 1), "Resultado ponderado", kind="label", fill=PALE_GREEN)
    for col in range(2, 10):
        formula(ws.cell(total_row, col), f"=SUM({chr(64+col)}14:{chr(64+col)}19)", 'COP #,##0;[Red](COP #,##0);-' if col in [3, 6, 7, 8, 9] else '#,##0.0;[Red](#,##0.0);-')
        ws.cell(total_row, col).fill = PatternFill("solid", fgColor=PALE_GREEN)
    formula(ws.cell(total_row, 10), "=SUM(D14:D19)", "0.0%")
    ws.cell(total_row, 10).fill = PatternFill("solid", fgColor=PALE_GREEN)
    formula(ws.cell(total_row, 11), '=IF(ABS(J20-1)<0.0001,"Mix válido","AJUSTAR: debe sumar 100%")')
    ws.cell(total_row, 11).fill = PatternFill("solid", fgColor=PALE_GREEN)

    style_section(ws, 22, "Caso de negocio Bogotá: ventas y costos revisados", 13)
    set_header(ws, 23, [
        "Mes", "Clientes activos", "Gasto legado", "Equiv. Pro 500", "Ingresos suscripciones", "Comercial/CAC inferido", "Reserva DeepSeek", "Mercado Pago", "Infraestructura compartida", "Costo antes provisión", "Provisión 10%", "Resultado antes gastos generales", "Margen"
    ])
    bogota_active = [8, 18.6, 31.7, 47.1, 62.7, 80.6, 98.6, 118.6, 138.7, 160.8, 182.7, 207.6]
    bogota_legacy = [512000, 930000, 1406000, 1941000, 2453000, 3040000, 3605000, 4225000, 4815000, 5471000, 6094000, 6927000]
    for i, (active, legacy) in enumerate(zip(bogota_active, bogota_legacy), 24):
        set_cell(ws.cell(i, 1), i - 23, kind="input", fill=YELLOW, num_format='0')
        set_cell(ws.cell(i, 2), active, kind="input", fill=YELLOW, num_format='#,##0.0')
        set_cell(ws.cell(i, 3), legacy, kind="input", fill=YELLOW, num_format='COP #,##0;[Red](COP #,##0);-', comment="Costo total histórico del caso de negocio, antes de reemplazar su supuesto técnico de COP 19.000.")
        formula(ws.cell(i, 4), f"=B{i}*$E$20/Planes!$B$8", '#,##0.0')
        formula(ws.cell(i, 5), f"=B{i}*$F$20", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(i, 6), f"=MAX(0,C{i}-B{i}*$B$9)", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(i, 7), f"=B{i}*$H$20", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(i, 8), f"=B{i}*$G$20", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(i, 9), f"=IF(D{i}>MAX(Capacidad!$A$5:$A$11),INDEX(Capacidad!$P$5:$P$11,ROWS(Capacidad!$P$5:$P$11))*ROUNDUP(D{i}/MAX(Capacidad!$A$5:$A$11),0),INDEX(Capacidad!$P$5:$P$11,MATCH(MAX(10,D{i}),Capacidad!$A$5:$A$11,1)))", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(i, 10), f"=SUM(F{i}:I{i})", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(i, 11), f"=J{i}*$B$5", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(i, 12), f"=E{i}-J{i}-K{i}", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(i, 13), f"=IFERROR(L{i}/E{i},0)", '0.0%')
    total = 36
    set_cell(ws.cell(total, 1), "Total 12 meses", kind="label", fill=PALE_GREEN)
    for col in range(2, 13):
        formula(ws.cell(total, col), f"=SUM({chr(64+col)}24:{chr(64+col)}35)", 'COP #,##0;[Red](COP #,##0);-' if col in [3, 5, 6, 7, 8, 9, 10, 11, 12] else '#,##0.0;[Red](#,##0.0);-')
        ws.cell(total, col).fill = PatternFill("solid", fgColor=PALE_GREEN)
    formula(ws.cell(total, 13), "=IFERROR(L36/E36,0)", '0.0%')
    ws.cell(total, 13).fill = PatternFill("solid", fgColor=PALE_GREEN)

    style_section(ws, 39, "Caso de negocio nacional: ventas y costos revisados", 13)
    set_header(ws, 40, [
        "Mes", "Clientes activos", "Gasto legado", "Equiv. Pro 500", "Ingresos suscripciones", "Comercial/CAC inferido", "Reserva DeepSeek", "Mercado Pago", "Infraestructura compartida", "Costo antes provisión", "Provisión 10%", "Resultado antes gastos generales", "Margen"
    ])
    national_active = [8, 18.6, 31.7, 47.1, 62.7, 80.6, 100.6, 125.5, 153.3, 186.6, 223.3, 266.1]
    national_legacy = [512000, 930000, 1406000, 1941000, 2453000, 3040000, 3883000, 4956000, 6051000, 7401000, 8784000, 10438000]
    for i, (active, legacy) in enumerate(zip(national_active, national_legacy), 41):
        set_cell(ws.cell(i, 1), i - 40, kind="input", fill=YELLOW, num_format='0')
        set_cell(ws.cell(i, 2), active, kind="input", fill=YELLOW, num_format='#,##0.0')
        set_cell(ws.cell(i, 3), legacy, kind="input", fill=YELLOW, num_format='COP #,##0;[Red](COP #,##0);-', comment="Costo total histórico del escenario nacional del caso de negocio.")
        formula(ws.cell(i, 4), f"=B{i}*$E$20/Planes!$B$8", '#,##0.0')
        formula(ws.cell(i, 5), f"=B{i}*$F$20", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(i, 6), f"=MAX(0,C{i}-B{i}*$B$9)", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(i, 7), f"=B{i}*$H$20", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(i, 8), f"=B{i}*$G$20", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(i, 9), f"=IF(D{i}>MAX(Capacidad!$A$5:$A$11),INDEX(Capacidad!$P$5:$P$11,ROWS(Capacidad!$P$5:$P$11))*ROUNDUP(D{i}/MAX(Capacidad!$A$5:$A$11),0),INDEX(Capacidad!$P$5:$P$11,MATCH(MAX(10,D{i}),Capacidad!$A$5:$A$11,1)))", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(i, 10), f"=SUM(F{i}:I{i})", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(i, 11), f"=J{i}*$B$5", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(i, 12), f"=E{i}-J{i}-K{i}", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(i, 13), f"=IFERROR(L{i}/E{i},0)", '0.0%')
    total = 53
    set_cell(ws.cell(total, 1), "Total 12 meses", kind="label", fill=PALE_GREEN)
    for col in range(2, 13):
        formula(ws.cell(total, col), f"=SUM({chr(64+col)}41:{chr(64+col)}52)", 'COP #,##0;[Red](COP #,##0);-' if col in [3, 5, 6, 7, 8, 9, 10, 11, 12] else '#,##0.0;[Red](#,##0.0);-')
        ws.cell(total, col).fill = PatternFill("solid", fgColor=PALE_GREEN)
    formula(ws.cell(total, 13), "=IFERROR(L53/E53,0)", '0.0%')
    ws.cell(total, 13).fill = PatternFill("solid", fgColor=PALE_GREEN)

    ws.freeze_panes = "A13"
    ws.auto_filter.ref = "A13:K19"
    return ws


def update_plan_profitability(wb):
    ws = wb["Planes"]
    # Preserve the original DeepSeek-only contribution and add payment collection explicitly.
    if "A13:M13" in {str(item) for item in ws.merged_cells.ranges}:
        ws.unmerge_cells("A13:M13")
    headers = [
        "Plan", "Domicilios", "Precio VIA COP", "Precio por domicilio", "Costo DeepSeek esperado", "Reserva operativa", "Reserva máxima DS", "Mensajes Meta cobrables", "Pago Meta tenant", "Contribución antes de recaudo", "Margen antes de recaudo", "Utilidad antes compartidos", "Margen antes compartidos", "Mercado Pago VIA", "Contribución tras recaudo", "Margen tras recaudo"
    ]
    set_header(ws, 4, headers)
    for row in range(5, 11):
        formula(ws.cell(row, 14), f"=(C{row}*'Modelo consolidado'!$B$6+'Modelo consolidado'!$B$7)*(1+'Modelo consolidado'!$B$8)", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(row, 15), f"=C{row}-F{row}-N{row}", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(row, 16), f"=IFERROR(O{row}/C{row},0)", '0.0%')
    ws.merge_cells("A13:P13")
    set_cell(ws["A13"], "Meta sigue siendo un pago directo del tenant. Mercado Pago es un costo de recaudo de VIA y se incorpora en M:O; la infraestructura compartida, comercial, soporte e impuestos se muestran en Modelo consolidado.", kind="label", fill=PALE_YELLOW)
    ws["A13"].alignment = Alignment(wrap_text=True, vertical="center")
    ws.row_dimensions[13].height = 30
    for col, width in {"A": 15, "B": 12, "C": 16, "D": 16, "E": 18, "F": 17, "G": 16, "H": 18, "I": 17, "J": 22, "K": 19, "L": 19, "M": 18, "N": 17, "O": 21, "P": 18}.items():
        ws.column_dimensions[col].width = width
    ws.freeze_panes = "A5"


def update_consolidated(wb):
    ws = wb["Consolidado VIA"]
    # The source note spans A:I. Expand it cleanly before adding the two new columns.
    if "A12:I12" in {str(item) for item in ws.merged_cells.ranges}:
        ws.unmerge_cells("A12:I12")
    ws["A1"] = "VIA | Consolidado de infraestructura por mix de planes"
    ws["A2"] = "El escenario usa la mezcla activa en Modelo consolidado. Meta sigue siendo un pago directo de cada tenant y no es ingreso ni costo de VIA."
    headers = [
        "Tenants activos", "Ingresos suscripciones", "DeepSeek esperado", "Reserva DeepSeek", "Mercado Pago", "Infraestructura compartida", "Costos antes provisión", "Provisión 10%", "Resultado antes impuestos", "Meta pagado por tenants", "Margen tras provisión"
    ]
    set_header(ws, 4, headers)
    for row in range(5, 12):
        ws.cell(row, 1).value = [10, 25, 50, 100, 250, 500, 1000][row - 5]
        formula(ws.cell(row, 2), f"=A{row}*'Modelo consolidado'!$F$20", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(row, 3), f"=A{row}*SUMPRODUCT(Planes!$E$5:$E$10,'Modelo consolidado'!$D$14:$D$19)", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(row, 4), f"=A{row}*'Modelo consolidado'!$H$20", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(row, 5), f"=A{row}*'Modelo consolidado'!$G$20", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(row, 6), f"=IF(A{row}*'Modelo consolidado'!$E$20/Planes!$B$8>MAX(Capacidad!$A$5:$A$11),INDEX(Capacidad!$P$5:$P$11,ROWS(Capacidad!$P$5:$P$11))*ROUNDUP(A{row}*'Modelo consolidado'!$E$20/Planes!$B$8/MAX(Capacidad!$A$5:$A$11),0),INDEX(Capacidad!$P$5:$P$11,MATCH(MAX(10,A{row}*'Modelo consolidado'!$E$20/Planes!$B$8),Capacidad!$A$5:$A$11,1)))", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(row, 7), f"=SUM(D{row}:F{row})", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(row, 8), f"=G{row}*'Modelo consolidado'!$B$5", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(row, 9), f"=B{row}-G{row}-H{row}", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(row, 10), f"=A{row}*'Modelo consolidado'!$I$20", 'COP #,##0;[Red](COP #,##0);-')
        formula(ws.cell(row, 11), f"=IFERROR(I{row}/B{row},0)", '0.0%')
    ws["A12"] = "Incluye reserva DeepSeek, recaudo e infraestructura; no incluye comercial/CAC, soporte, impuestos ni administración."
    ws.merge_cells("A12:K12")
    set_cell(ws["A12"], ws["A12"].value, kind="label", fill=PALE_YELLOW)
    for col, width in {"A": 17, "B": 22, "C": 19, "D": 19, "E": 16, "F": 24, "G": 21, "H": 17, "I": 23, "J": 21, "K": 18}.items():
        ws.column_dimensions[col].width = width
    ws.freeze_panes = "A5"


def update_dashboard(wb):
    ws = wb["Dashboard"]
    ws["A2"] = "Modelo multi-plan: los seis planes se ponderan en Modelo consolidado. Tasa de presupuesto: COP 3.300/USD. Actualiza únicamente las celdas amarillas para recalcular."
    ws["H9"] = "Contribución tras recaudo"
    ws["I9"] = "Margen tras recaudo"
    for row, plan_row in enumerate(range(5, 11), 10):
        formula_link(ws.cell(row, 8), f"=Planes!O{plan_row}", 'COP #,##0;[Red](COP #,##0);-')
        formula_link(ws.cell(row, 9), f"=Planes!P{plan_row}", '0.0%')
    style_section(ws, 36, "Lectura comercial consolidada", 12)
    entries = [
        ("Mix vigente", "='Modelo consolidado'!J20", "0.0%"),
        ("Precio ponderado por tenant", "='Modelo consolidado'!F20", 'COP #,##0;[Red](COP #,##0);-'),
        ("Domicilios ponderados por tenant", "='Modelo consolidado'!E20", '#,##0.0;[Red](#,##0.0);-'),
        ("Reserva DeepSeek por tenant", "='Modelo consolidado'!H20", 'COP #,##0;[Red](COP #,##0);-'),
        ("Recaudo Mercado Pago por tenant", "='Modelo consolidado'!G20", 'COP #,##0;[Red](COP #,##0);-'),
        ("Resultado Bogotá 12 meses", "='Modelo consolidado'!L36", 'COP #,##0;[Red](COP #,##0);-'),
        ("Resultado nacional 12 meses", "='Modelo consolidado'!L53", 'COP #,##0;[Red](COP #,##0);-'),
    ]
    for row, (label, value, fmt) in enumerate(entries, 37):
        set_cell(ws.cell(row, 1), label, kind="label", fill=GRAY)
        formula_link(ws.cell(row, 2), value, fmt)
        ws.merge_cells(start_row=row, start_column=2, end_row=row, end_column=3)
    ws.merge_cells("A45:L45")
    set_cell(ws["A45"], "La mezcla comercial inicia 100% Pro, pero puede cambiarse en Modelo consolidado. Meta es un cobro directo de cada tenant; no se incorpora en la utilidad de VIA.", kind="label", fill=PALE_YELLOW)
    ws["A45"].alignment = Alignment(wrap_text=True, vertical="center")
    ws.row_dimensions[45].height = 30


def main():
    wb = load_workbook(SOURCE)
    wb.calculation.fullCalcOnLoad = True
    wb.calculation.forceFullCalc = True
    wb.calculation.calcMode = "auto"
    for ws in wb.worksheets:
        apply_font(ws)
    create_model_sheet(wb)
    update_plan_profitability(wb)
    update_consolidated(wb)
    update_dashboard(wb)
    wb.save(TARGET)
    print(TARGET)


if __name__ == "__main__":
    main()
