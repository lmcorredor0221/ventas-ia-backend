import os
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.chart import BarChart, LineChart, PieChart, Reference
from openpyxl.styles import Alignment, PatternFill

from create_consolidated_financial_model import (
    GRAY,
    PALE_GREEN,
    PALE_YELLOW,
    SOURCE,
    YELLOW,
    apply_font,
    create_model_sheet,
    formula,
    formula_link,
    set_cell,
    set_header,
    style_section,
    style_subtitle,
    style_title,
    update_consolidated,
    update_dashboard,
    update_plan_profitability,
)
from create_market_commission_model import create_commission_sheet, capacity_formula


TARGET = Path(os.getenv("VIA_MARKET_ROI_TARGET", Path(__file__).resolve().parents[1] / "docs" / "Dashboard-estrategico-VIA-2026-10-21-mercado-ROI.xlsx"))
CURRENCY = 'COP #,##0;[Red](COP #,##0);-'
NUMBER = '#,##0.0;[Red](#,##0.0);-'


def create_market_sheet(wb):
    if "Mercado TAM SAM SOM" in wb.sheetnames:
        del wb["Mercado TAM SAM SOM"]
    ws = wb.create_sheet("Mercado TAM SAM SOM", 3)
    ws.sheet_view.showGridLines = False
    for col, width in {
        "A": 24, "B": 16, "C": 15, "D": 18, "E": 17, "F": 17, "G": 17,
        "H": 17, "I": 17, "J": 17, "K": 22,
    }.items():
        ws.column_dimensions[col].width = width

    style_title(ws, ws.cell(1, 1), "VIA | Mercado, mezcla de planes y TAM/SAM/SOM", 11)
    style_subtitle(ws, 2, "SOM significa mercado obtenible. El tamaño nacional es una medición de tiendas y panaderías; las ciudades fuera de Bogotá son proxies de priorización geográfica, no conteos oficiales de tiendas.", 11)

    style_section(ws, 4, "Supuestos de mercado", 11)
    assumptions = [
        ("TAM Colombia: panaderías y tiendas de barrio", 540233, '#,##0', "DANE EMICRON 2024."),
        ("SAM Bogotá histórico: unidades con potencial", 119982, '#,##0', "Referencia CCB usada en el caso de negocio; debe renovarse con evidencia local."),
        ("Bogotá: participación valor agregado 2025", 0.312, "0.0%", "DANE EMICRON 24 ciudades; sirve para ponderar prioridad, no para contar tiendas."),
        ("Medellín A.M.: participación valor agregado 2025", 0.205, "0.0%", "DANE EMICRON 24 ciudades."),
        ("Cali A.M.: participación valor agregado 2025", 0.079, "0.0%", "DANE EMICRON 24 ciudades."),
        ("Bucaramanga A.M.: participación valor agregado 2025", 0.078, "0.0%", "DANE EMICRON 24 ciudades."),
        ("Barranquilla A.M.: participación valor agregado 2025", 0.076, "0.0%", "DANE EMICRON 24 ciudades."),
    ]
    for row, (label, value, fmt, note) in enumerate(assumptions, 5):
        set_cell(ws.cell(row, 1), label, kind="label", fill=GRAY)
        set_cell(ws.cell(row, 2), value, kind="input", fill=YELLOW, num_format=fmt, comment=note)
        set_cell(ws.cell(row, 3), note, kind="label")
        ws.merge_cells(start_row=row, start_column=3, end_row=row, end_column=11)

    style_section(ws, 13, "Mezcla comercial objetivo de los seis planes (mes 7 en adelante)", 11)
    set_header(ws, 14, ["Plan", "Precio mensual", "Mix comercial", "Domicilios", "Reserva DeepSeek", "Mercado Pago", "Comisión M1", "Comisión M2", "Comisión M3-M5", "Comisión máxima", "Nota"])
    mix = [0.20, 0.25, 0.25, 0.20, 0.08, 0.02]
    for row, (plan_row, share) in enumerate(zip(range(5, 11), mix), 15):
        formula_link(ws.cell(row, 1), f"=Planes!A{plan_row}")
        formula_link(ws.cell(row, 2), f"=Planes!C{plan_row}", CURRENCY)
        set_cell(ws.cell(row, 3), share, kind="input", fill=YELLOW, num_format="0.0%", comment="Mezcla objetivo desde el mes 7. Los primeros seis meses se detallan por cohorte y no incluyen Escala ni Red.")
        formula_link(ws.cell(row, 4), f"=Planes!B{plan_row}", '#,##0')
        formula_link(ws.cell(row, 5), f"=Planes!F{plan_row}", CURRENCY)
        formula_link(ws.cell(row, 6), f"=Planes!N{plan_row}", CURRENCY)
        formula_link(ws.cell(row, 7), f"=Comisiones!D{row - 2}", CURRENCY)
        formula_link(ws.cell(row, 8), f"=Comisiones!E{row - 2}", CURRENCY)
        formula_link(ws.cell(row, 9), f"=Comisiones!F{row - 2}", CURRENCY)
        formula_link(ws.cell(row, 10), f"=Comisiones!I{row - 2}", CURRENCY)
        set_cell(ws.cell(row, 11), "Comisión solo por tenant activo y cobrado.", kind="label")
    total = 21
    set_cell(ws.cell(total, 1), "Promedio ponderado", kind="label", fill=PALE_GREEN)
    for col in [2, 4, 5, 6, 7, 8, 9, 10]:
        letter = chr(64 + col)
        formula(ws.cell(total, col), f"=SUMPRODUCT({letter}15:{letter}20,$C$15:$C$20)", CURRENCY if col not in [4] else NUMBER)
        ws.cell(total, col).fill = PatternFill("solid", fgColor=PALE_GREEN)
    formula(ws.cell(total, 3), "=SUM(C15:C20)", "0.0%")
    ws.cell(total, 3).fill = PatternFill("solid", fgColor=PALE_GREEN)
    set_cell(ws.cell(total, 11), '=IF(ABS(C21-1)<0.0001,"Mix válido","AJUSTAR: debe sumar 100%")', kind="formula", fill=PALE_GREEN)

    style_section(ws, 24, "TAM, SAM y SOM por ciudad", 11)
    set_header(ws, 25, ["Mercado", "Inicio", "Canal", "Factor geográfico", "SAM proxy", "SOM mes 12", "% SOM / SAM", "MRR mes 12 aprox.", "ARR potencial SAM", "Fuente / límite"])
    cities = [
        ("Bogotá", 1, "Asistido + digital", "=1", "=$B$6", "='ROI y expansión'!H24", "CCB histórico para SAM; operación desde mes 1."),
        ("Medellín A.M.", 6, "Solo digital", "=$B$8/$B$7", "=$B$6*D27", "='ROI y expansión'!I24", "Expansión digital desde mes 6; no es censo de tiendas."),
        ("Cali A.M.", 6, "Solo digital", "=$B$9/$B$7", "=$B$6*D28", "='ROI y expansión'!J24", "Expansión digital desde mes 6; no es censo de tiendas."),
        ("Bucaramanga A.M.", 6, "Solo digital", "=$B$10/$B$7", "=$B$6*D29", "='ROI y expansión'!K24", "Expansión digital desde mes 6; no es censo de tiendas."),
        ("Barranquilla A.M.", 6, "Solo digital", "=$B$11/$B$7", "=$B$6*D30", "='ROI y expansión'!L24", "Expansión digital desde mes 6; no es censo de tiendas."),
    ]
    for row, (city, start, channel, factor, sam, som, note) in enumerate(cities, 26):
        set_cell(ws.cell(row, 1), city, kind="label")
        set_cell(ws.cell(row, 2), start, kind="input", fill=YELLOW, num_format='0')
        set_cell(ws.cell(row, 3), channel, kind="input", fill=YELLOW)
        formula(ws.cell(row, 4), factor, "0.0%")
        formula(ws.cell(row, 5), sam, '#,##0')
        formula_link(ws.cell(row, 6), som, NUMBER)
        formula(ws.cell(row, 7), f"=IFERROR(F{row}/E{row},0)", "0.000%")
        formula(ws.cell(row, 8), f"=F{row}*$B$21", CURRENCY)
        formula(ws.cell(row, 9), f"=E{row}*$B$21*12", CURRENCY)
        set_cell(ws.cell(row, 10), note, kind="label")
    row = 31
    set_cell(ws.cell(row, 1), "SAM cinco ciudades", kind="label", fill=PALE_GREEN)
    for col in [5, 6, 8, 9]:
        letter = chr(64 + col)
        formula(ws.cell(row, col), f"=SUM({letter}26:{letter}30)", CURRENCY if col in [8, 9] else NUMBER)
        ws.cell(row, col).fill = PatternFill("solid", fgColor=PALE_GREEN)
    formula(ws.cell(row, 7), "=IFERROR(F31/E31,0)", "0.000%")
    ws.cell(row, 7).fill = PatternFill("solid", fgColor=PALE_GREEN)
    set_cell(ws.cell(row, 10), "Suma de proxies; no equivale a una estimación oficial de tiendas por ciudad.", kind="label", fill=PALE_GREEN)

    style_section(ws, 34, "Lectura consolidada de mercado", 11)
    set_header(ws, 35, ["Nivel", "Tiendas / unidades", "Precio promedio mensual", "MRR potencial", "ARR potencial", "Definición"])
    rows = [
        ("TAM Colombia", "=$B$5", "=B21", "=B36*C36", "=D36*12", "Todas las tiendas y panaderías medidas por DANE, sin filtrar capacidad de pago o adopción."),
        ("SAM cinco ciudades", "=E31", "=B21", "=B37*C37", "=D37*12", "Mercado priorizado: Bogotá y expansión digital en cuatro ciudades; ciudades fuera de Bogotá son proxies."),
        ("SOM año 1", "='Proyección por plan'!$W$24", "=IFERROR('Proyección por plan'!$X$24/'Proyección por plan'!$W$24,0)", "='Proyección por plan'!$X$24", "=D38*12", "Clientes activos proyectados al mes 12. Usa la mezcla efectiva de cohortes, no el promedio objetivo."),
    ]
    for row, (level, units, price, mrr, arr, note) in enumerate(rows, 36):
        set_cell(ws.cell(row, 1), level, kind="label", fill=PALE_GREEN if row == 38 else GRAY)
        formula(ws.cell(row, 2), units, NUMBER)
        formula(ws.cell(row, 3), price, CURRENCY)
        formula(ws.cell(row, 4), mrr, CURRENCY)
        formula(ws.cell(row, 5), arr, CURRENCY)
        set_cell(ws.cell(row, 6), note, kind="label")
        ws.merge_cells(start_row=row, start_column=6, end_row=row, end_column=11)

    bar = BarChart()
    bar.type = "bar"
    bar.style = 10
    bar.title = "Precio mensual por plan"
    bar.y_axis.title = "Plan"
    bar.x_axis.title = "COP"
    bar.add_data(Reference(ws, min_col=2, min_row=14, max_row=20), titles_from_data=True)
    bar.set_categories(Reference(ws, min_col=1, min_row=15, max_row=20))
    bar.height = 7
    bar.width = 13
    ws.add_chart(bar, "A42")
    pie = PieChart()
    pie.title = "Mezcla comercial objetivo M7+"
    pie.add_data(Reference(ws, min_col=3, min_row=14, max_row=20), titles_from_data=True)
    pie.set_categories(Reference(ws, min_col=1, min_row=15, max_row=20))
    pie.height = 7
    pie.width = 10
    ws.add_chart(pie, "H42")
    ws.freeze_panes = "A15"
    return ws


def create_plan_projection_sheet(wb):
    if "Proyección por plan" in wb.sheetnames:
        del wb["Proyección por plan"]
    ws = wb.create_sheet("Proyección por plan", 4)
    ws.sheet_view.showGridLines = False
    for col, width in {
        "A": 9, "B": 16, "C": 16, "D": 14, "E": 13, "F": 13, "G": 16,
        "H": 13, "I": 15, "J": 13, "K": 14, "L": 14, "M": 17, "N": 14,
        "O": 16, "P": 14, "Q": 16, "R": 16, "S": 19, "T": 16, "U": 18,
        "V": 16, "W": 16, "X": 18, "Y": 16, "Z": 18, "AA": 18, "AB": 14,
    }.items():
        ws.column_dimensions[col].width = width

    style_title(ws, ws.cell(1, 1), "VIA | Proyección mensual por plan", 28)
    style_subtitle(ws, 2, "Los primeros seis meses concentran Inicio, Base, Crecimiento y Pro. Escala y Red se habilitan solo desde el mes 7. Las celdas amarillas son supuestos de mezcla; el resto se calcula desde las altas geográficas.", 28)

    style_section(ws, 4, "Rampa comercial por plan", 28)
    headers = [
        "Mes", "Altas directas", "Altas digitales", "Altas totales", "Mix Inicio", "Mix Base", "Mix Crecimiento", "Mix Pro", "Mix Escala", "Mix Red",
        "Altas Inicio", "Altas Base", "Altas Crecimiento", "Altas Pro", "Altas Escala", "Altas Red",
        "Activos Inicio", "Activos Base", "Activos Crecimiento", "Activos Pro", "Activos Escala", "Activos Red", "Activos total",
        "Ingresos", "DeepSeek", "Mercado Pago", "Comisiones directas", "Control mix",
    ]
    set_header(ws, 12, headers)
    early_mix = [0.30, 0.30, 0.25, 0.15, 0, 0]
    plan_columns = ["E", "F", "G", "H", "I", "J"]
    high_columns = ["K", "L", "M", "N", "O", "P"]
    active_columns = ["Q", "R", "S", "T", "U", "V"]
    plan_rows = list(range(5, 11))
    commission_rows = list(range(13, 19))

    def weighted_active(row, plan_column):
        return "+".join(
            f"{active_column}{row}*Planes!${plan_column}${plan_row}"
            for active_column, plan_row in zip(active_columns, plan_rows)
        )

    def weighted_commission_mix(row, commission_column):
        return "+".join(
            f"{mix_column}{row}*Comisiones!${commission_column}${commission_row}"
            for mix_column, commission_row in zip(plan_columns, commission_rows)
        )

    for i in range(12):
        row = 13 + i
        formula_link(ws.cell(row, 1), f"='ROI y expansión'!A{row}", '#,##0')
        formula_link(ws.cell(row, 2), f"='ROI y expansión'!B{row}", NUMBER)
        formula_link(ws.cell(row, 3), f"=SUM('ROI y expansión'!C{row}:G{row})", NUMBER)
        formula(ws.cell(row, 4), f"=SUM(B{row}:C{row})", NUMBER)
        for column, initial_share, market_row in zip(range(5, 11), early_mix, range(15, 21)):
            if i < 6:
                set_cell(ws.cell(row, column), initial_share, kind="input", fill=YELLOW, num_format="0.0%", comment="Rampa inicial: Escala y Red no se comercializan antes del mes 7.")
            else:
                formula_link(ws.cell(row, column), f"='Mercado TAM SAM SOM'!C{market_row}", "0.0%")
        formula(ws.cell(row, 28), f"=SUM(E{row}:J{row})", "0.0%")
        for column, mix_column in zip(range(11, 17), plan_columns):
            formula(ws.cell(row, column), f"=D{row}*{mix_column}{row}", NUMBER)
        for index, (column, high_column) in enumerate(zip(range(17, 23), high_columns)):
            if i == 0:
                formula(ws.cell(row, column), f"={high_column}{row}", NUMBER)
            else:
                formula(ws.cell(row, column), f"={active_columns[index]}{row - 1}*(1-'ROI y expansión'!$B$5)+{high_column}{row}", NUMBER)
        formula(ws.cell(row, 23), f"=SUM(Q{row}:V{row})", NUMBER)
        formula(ws.cell(row, 24), f"={weighted_active(row, 'C')}", CURRENCY)
        formula(ws.cell(row, 25), f"={weighted_active(row, 'F')}", CURRENCY)
        formula(ws.cell(row, 26), f"={weighted_active(row, 'N')}", CURRENCY)
        direct_commission = f"=B{row}*({weighted_commission_mix(row, 'D')})"
        if i >= 1:
            prior = row - 1
            direct_commission += f"+B{prior}*(1-'ROI y expansión'!$B$5)*({weighted_commission_mix(prior, 'E')})"
        for lag in range(2, min(i, 4) + 1):
            prior = row - lag
            direct_commission += f"+B{prior}*(1-'ROI y expansión'!$B$5)^{lag}*({weighted_commission_mix(prior, 'F')})"
        formula(ws.cell(row, 27), direct_commission, CURRENCY)

    style_section(ws, 27, "Controles y resumen anual por plan", 28)
    set_header(ws, 28, ["Control", "Resultado", "Criterio", "Plan", "Altas año", "Activos mes 12", "Ingresos 12m", "DeepSeek 12m", "Mercado Pago 12m", "Comisiones directas 12m"])
    control_rows = [
        ("Altas Escala meses 1-6", "=SUM(O13:O18)", "Debe ser 0"),
        ("Altas Red meses 1-6", "=SUM(P13:P18)", "Debe ser 0"),
        ("Mix mensual valido", "=MIN(AB13:AB24)", "Debe ser 100 %"),
    ]
    for row, (label, calculation, criterion) in enumerate(control_rows, 29):
        set_cell(ws.cell(row, 1), label, kind="label", fill=GRAY)
        formula(ws.cell(row, 2), calculation, "0.0%" if row == 31 else NUMBER)
        set_cell(ws.cell(row, 3), criterion, kind="label")
    for row, plan_row in enumerate(range(5, 11), 29):
        formula_link(ws.cell(row, 4), f"=Planes!A{plan_row}")
        source_column = high_columns[row - 29]
        active_column = active_columns[row - 29]
        formula(ws.cell(row, 5), f"=SUM({source_column}$13:{source_column}$24)", NUMBER)
        formula(ws.cell(row, 6), f"={active_column}$24", NUMBER)
        formula(ws.cell(row, 7), f"=SUM({active_column}$13:{active_column}$24)*Planes!$C${plan_row}", CURRENCY)
        formula(ws.cell(row, 8), f"=SUM({active_column}$13:{active_column}$24)*Planes!$F${plan_row}", CURRENCY)
        formula(ws.cell(row, 9), f"=SUM({active_column}$13:{active_column}$24)*Planes!$N${plan_row}", CURRENCY)
        mix_column = plan_columns[row - 29]
        commission_row = commission_rows[row - 29]
        commission_formula = [
            f"SUMPRODUCT($B$13:$B$24,${mix_column}$13:${mix_column}$24)*Comisiones!$D${commission_row}",
            f"SUMPRODUCT($B$13:$B$23,${mix_column}$13:${mix_column}$23)*(1-'ROI y expansión'!$B$5)*Comisiones!$E${commission_row}",
            f"SUMPRODUCT($B$13:$B$22,${mix_column}$13:${mix_column}$22)*(1-'ROI y expansión'!$B$5)^2*Comisiones!$F${commission_row}",
            f"SUMPRODUCT($B$13:$B$21,${mix_column}$13:${mix_column}$21)*(1-'ROI y expansión'!$B$5)^3*Comisiones!$F${commission_row}",
            f"SUMPRODUCT($B$13:$B$20,${mix_column}$13:${mix_column}$20)*(1-'ROI y expansión'!$B$5)^4*Comisiones!$F${commission_row}",
        ]
        formula(ws.cell(row, 10), f"={' + '.join(commission_formula)}", CURRENCY)
    set_cell(ws.cell(35, 4), "Total", kind="label", fill=PALE_GREEN)
    for col in range(5, 11):
        formula(ws.cell(35, col), f"=SUM({chr(64 + col)}29:{chr(64 + col)}34)", CURRENCY if col >= 7 else NUMBER)
        ws.cell(35, col).fill = PatternFill("solid", fgColor=PALE_GREEN)

    active_chart = LineChart()
    active_chart.style = 13
    active_chart.title = "Activos por plan"
    active_chart.y_axis.title = "Tenants activos"
    active_chart.x_axis.title = "Mes"
    active_chart.add_data(Reference(ws, min_col=17, max_col=22, min_row=12, max_row=24), titles_from_data=True)
    active_chart.set_categories(Reference(ws, min_col=1, min_row=13, max_row=24))
    active_chart.height = 8
    active_chart.width = 16
    ws.add_chart(active_chart, "A38")
    high_chart = BarChart()
    high_chart.type = "bar"
    high_chart.style = 10
    high_chart.title = "Altas proyectadas por plan"
    high_chart.x_axis.title = "Altas año 1"
    high_chart.y_axis.title = "Plan"
    high_chart.add_data(Reference(ws, min_col=5, min_row=28, max_row=34), titles_from_data=True)
    high_chart.set_categories(Reference(ws, min_col=4, min_row=29, max_row=34))
    high_chart.height = 8
    high_chart.width = 14
    ws.add_chart(high_chart, "Q38")
    ws.freeze_panes = "A13"
    return ws


def extend_plan_profitability(wb):
    ws = wb["Planes"]
    # Meta is paid by each tenant directly. Make the monthly and annual reference
    # explicit so it cannot be confused with VIA revenue or cost of service.
    set_cell(ws.cell(2, 1), "Precios de suscripcion mensual antes de IVA. Meta se paga directamente por cada tenant y no hace parte de los ingresos, costos ni márgenes de VIA.", kind="label")
    set_cell(ws.cell(4, 8), "Mensajes Meta estimados / mes", kind="label", fill=GRAY)
    set_cell(ws.cell(4, 9), "Meta: pago tenant / mes", kind="label", fill=GRAY)
    set_cell(ws.cell(13, 1), "Meta se paga directamente a Meta. La columna I estima el pago mensual de un tenant; la referencia anual de la columna N suma los tenant-meses activos del plan. Ninguno se descuenta del resultado de VIA.", kind="label", fill=GRAY)
    style_section(ws, 15, "Rentabilidad proyectada a 12 meses por plan", 16)
    set_header(ws, 16, [
        "Plan", "Altas año 1", "Activos mes 12", "Ingresos 12m", "DeepSeek", "Mercado Pago", "Comisiones", "CAC digital", "Infraestructura asignada", "Costos antes provisión", "Provisión", "Resultado 12m", "Margen", "Meta: tenants 12m", "Criterio de asignación", "Alcance / exclusiones",
    ])
    plan_projection_rows = range(29, 35)
    plan_rows = range(5, 11)
    plan_mix_columns = ["E", "F", "G", "H", "I", "J"]
    plan_active_columns = ["Q", "R", "S", "T", "U", "V"]
    capacity_weighted_active = "+".join(
        f"SUM('Proyección por plan'!${active_column}$13:${active_column}$24)*$B${plan_row}"
        for active_column, plan_row in zip(plan_active_columns, plan_rows)
    )
    shared_infrastructure = "SUM('ROI y expansión'!$S$13:$S$24)"

    for row, (plan_row, projection_row, mix_column, active_column) in enumerate(zip(plan_rows, plan_projection_rows, plan_mix_columns, plan_active_columns), 17):
        formula(ws.cell(row, 1), f"=A{plan_row}")
        formula_link(ws.cell(row, 2), f"='Proyección por plan'!E{projection_row}", NUMBER)
        formula_link(ws.cell(row, 3), f"='Proyección por plan'!F{projection_row}", NUMBER)
        formula_link(ws.cell(row, 4), f"='Proyección por plan'!G{projection_row}", CURRENCY)
        formula_link(ws.cell(row, 5), f"='Proyección por plan'!H{projection_row}", CURRENCY)
        formula_link(ws.cell(row, 6), f"='Proyección por plan'!I{projection_row}", CURRENCY)
        formula_link(ws.cell(row, 7), f"='Proyección por plan'!J{projection_row}", CURRENCY)
        formula_link(ws.cell(row, 8), f"=SUMPRODUCT('Proyección por plan'!$C$13:$C$24,'Proyección por plan'!${mix_column}$13:${mix_column}$24)*'ROI y expansión'!$B$6", CURRENCY)
        formula_link(ws.cell(row, 9), f"=IFERROR(SUM('Proyección por plan'!${active_column}$13:${active_column}$24)*$B${plan_row}/({capacity_weighted_active})*{shared_infrastructure},0)", CURRENCY)
        formula(ws.cell(row, 10), f"=SUM(E{row}:I{row})", CURRENCY)
        formula_link(ws.cell(row, 11), f"=J{row}*'ROI y expansión'!$B$7", CURRENCY)
        formula(ws.cell(row, 12), f"=D{row}-J{row}-K{row}", CURRENCY)
        formula(ws.cell(row, 13), f"=IFERROR(L{row}/D{row},0)", "0.0%")
        formula_link(ws.cell(row, 14), f"=SUM('Proyección por plan'!${active_column}$13:${active_column}$24)*$I${plan_row}", CURRENCY)
        set_cell(ws.cell(row, 15), "Infraestructura: capacidad de domicilios incluida", kind="label")
        set_cell(ws.cell(row, 16), "Resultado VIA excluye Meta (pago directo del tenant), soporte, administración, desarrollo e impuestos.", kind="label")
        ws.cell(row, 14).fill = PatternFill("solid", fgColor=PALE_YELLOW)

    total_row = 23
    set_cell(ws.cell(total_row, 1), "Total VIA", kind="label", fill=PALE_GREEN)
    for col in range(2, 13):
        column = chr(64 + col)
        formula(ws.cell(total_row, col), f"=SUM({column}17:{column}22)", CURRENCY if col >= 4 else NUMBER)
        ws.cell(total_row, col).fill = PatternFill("solid", fgColor=PALE_GREEN)
    formula(ws.cell(total_row, 13), "=IFERROR(L23/D23,0)", "0.0%")
    ws.cell(total_row, 13).fill = PatternFill("solid", fgColor=PALE_GREEN)
    formula(ws.cell(total_row, 14), "=SUM(N17:N22)", CURRENCY)
    ws.cell(total_row, 14).fill = PatternFill("solid", fgColor=PALE_GREEN)
    set_cell(ws.cell(total_row, 15), "La infraestructura se reconcilia con ROI y expansión.", kind="label", fill=PALE_GREEN)
    set_cell(ws.cell(total_row, 16), "Meta es una referencia externa: cada tenant paga directamente a Meta.", kind="label", fill=PALE_GREEN)

    set_cell(ws.cell(24, 1), "Lectura de Meta: la cifra de la columna N no es una factura de VIA ni un valor por tenant. Es la suma anual estimada que pagarían los tenants activos de ese plan: tenant-meses activos × pago Meta mensual por tenant.", kind="label", fill=PALE_YELLOW)
    ws.merge_cells(start_row=24, start_column=1, end_row=24, end_column=16)

    chart = BarChart()
    chart.type = "bar"
    chart.style = 10
    chart.title = "Resultado proyectado a 12 meses por plan"
    chart.x_axis.title = "COP"
    chart.y_axis.title = "Plan"
    chart.add_data(Reference(ws, min_col=12, min_row=16, max_row=22), titles_from_data=True)
    chart.set_categories(Reference(ws, min_col=1, min_row=17, max_row=22))
    chart.height = 9
    chart.width = 15
    ws.add_chart(chart, "A26")
    for col, width in {
        "A": 16, "B": 14, "C": 15, "D": 17, "E": 15, "F": 16, "G": 16, "H": 15,
        "I": 22, "J": 19, "K": 14, "L": 18, "M": 12, "N": 16, "O": 24, "P": 32,
    }.items():
        ws.column_dimensions[col].width = width


def create_roi_sheet(wb):
    if "ROI y expansión" in wb.sheetnames:
        del wb["ROI y expansión"]
    ws = wb.create_sheet("ROI y expansión", 4)
    ws.sheet_view.showGridLines = False
    for col, width in {
        "A": 9, "B": 16, "C": 16, "D": 14, "E": 14, "F": 14, "G": 16,
        "H": 16, "I": 16, "J": 16, "K": 16, "L": 16, "M": 16, "N": 18,
        "O": 18, "P": 17, "Q": 15, "R": 15, "S": 20, "T": 20, "U": 17,
        "V": 18, "W": 20,
    }.items():
        ws.column_dimensions[col].width = width

    style_title(ws, ws.cell(1, 1), "VIA | ROI y expansión geográfica", 23)
    style_subtitle(ws, 2, "Bogotá inicia con venta asistida y digital. Medellín, Cali, Bucaramanga y Barranquilla reciben altas solo digitales desde el mes 6. Las celdas amarillas son hipótesis de adquisición y CAC, no ventas reales.", 23)
    style_section(ws, 4, "Entradas", 23)
    inputs = [
        ("Churn mensual", "=Comisiones!B5", "0.0%", "Ligado al esquema de continuidad de comisiones."),
        ("CAC digital por alta pagada", 120000, CURRENCY, "Supuesto histórico del caso de negocio. Debe reemplazarse con CAC medido por ciudad y canal."),
        ("Provisión sobre costos modelados", "='Modelo consolidado'!B5", "0.0%", "Reserva operativa del modelo financiero."),
        ("Vendedores Bogotá", 2, '#,##0', "La proyección de altas asistidas de Bogotá se distribuye entre estos vendedores."),
    ]
    for row, (label, value, fmt, note) in enumerate(inputs, 5):
        set_cell(ws.cell(row, 1), label, kind="label", fill=GRAY)
        kind = "link" if isinstance(value, str) and value.startswith("=") else "input"
        set_cell(ws.cell(row, 2), value, kind=kind, fill=YELLOW if kind == "input" else None, num_format=fmt, comment=note)
        set_cell(ws.cell(row, 3), note, kind="label")
        ws.merge_cells(start_row=row, start_column=3, end_row=row, end_column=23)

    style_section(ws, 11, "Expansión mensual y flujo de caja", 23)
    headers = [
        "Mes", "Asistido Bogotá", "Digital Bogotá", "Digital Medellín", "Digital Cali", "Digital Bucaramanga", "Digital Barranquilla", "Activos Bogotá", "Activos Medellín", "Activos Cali", "Activos Bucaramanga", "Activos Barranquilla", "Activos total", "Ingresos", "Comisiones", "CAC digital", "DeepSeek", "Mercado Pago", "Infraestructura", "Costos antes provisión", "Provisión", "Resultado", "Resultado acumulado",
    ]
    set_header(ws, 12, headers)
    assisted = [6, 8, 10, 12, 12, 14, 14, 16, 16, 18, 18, 20]
    bogota_digital = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14]
    medellin = [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 8]
    cali = [0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7]
    bucaramanga = [0, 0, 0, 0, 0, 1, 1, 2, 3, 4, 4, 5]
    barranquilla = [0, 0, 0, 0, 0, 1, 1, 1, 2, 3, 3, 4]
    rows = []
    for i in range(12):
        r = 13 + i
        rows.append(r)
        set_cell(ws.cell(r, 1), i + 1, kind="input", fill=YELLOW, num_format='0')
        for col, val in enumerate([assisted[i], bogota_digital[i], medellin[i], cali[i], bucaramanga[i], barranquilla[i]], 2):
            set_cell(ws.cell(r, col), val, kind="input", fill=YELLOW, num_format='#,##0')
        if i == 0:
            starts = ["=B13+C13", "=D13", "=E13", "=F13", "=G13"]
            formula(ws.cell(r, 23), "=V13", CURRENCY)
        else:
            starts = [f"=H{r - 1}*(1-$B$5)+B{r}+C{r}", f"=I{r - 1}*(1-$B$5)+D{r}", f"=J{r - 1}*(1-$B$5)+E{r}", f"=K{r - 1}*(1-$B$5)+F{r}", f"=L{r - 1}*(1-$B$5)+G{r}"]
            formula(ws.cell(r, 23), f"=W{r - 1}+V{r}", CURRENCY)
        for col, value in enumerate(starts, 8):
            formula(ws.cell(r, col), value, NUMBER)
        formula_link(ws.cell(r, 13), f"='Proyección por plan'!W{r}", NUMBER)
        formula_link(ws.cell(r, 14), f"='Proyección por plan'!X{r}", CURRENCY)
        formula_link(ws.cell(r, 15), f"='Proyección por plan'!AA{r}", CURRENCY)
        formula(ws.cell(r, 16), f"=SUM(C{r}:G{r})*$B$6", CURRENCY)
        formula_link(ws.cell(r, 17), f"='Proyección por plan'!Y{r}", CURRENCY)
        formula_link(ws.cell(r, 18), f"='Proyección por plan'!Z{r}", CURRENCY)
        formula(ws.cell(r, 19), capacity_formula(f"M{r}"), CURRENCY)
        formula(ws.cell(r, 20), f"=SUM(O{r}:S{r})", CURRENCY)
        formula(ws.cell(r, 21), f"=T{r}*$B$7", CURRENCY)
        formula(ws.cell(r, 22), f"=N{r}-T{r}-U{r}", CURRENCY)

    style_section(ws, 28, "Resumen de ROI", 23)
    set_header(ws, 29, ["Altas directas", "Altas digitales", "Altas totales", "Activos mes 12", "Ingresos 12m", "Comisiones", "CAC digital", "DeepSeek", "Mercado Pago", "Infraestructura", "Provisión", "Resultado antes de gastos generales", "Inversión de adquisición", "ROI sobre inversión de adquisición", "Mes mensual positivo", "Mes acumulado positivo"])
    formulas = [
        "=SUM(B13:B24)", "=SUM(C13:G24)", "=A30+B30", "=M24", "=SUM(N13:N24)", "=SUM(O13:O24)", "=SUM(P13:P24)", "=SUM(Q13:Q24)", "=SUM(R13:R24)", "=SUM(S13:S24)", "=SUM(U13:U24)", "=SUM(V13:V24)", "=F30+G30", "=IFERROR(L30/M30,0)",
    ]
    for col, value in enumerate(formulas, 1):
        fmt = CURRENCY
        if col in [1, 2, 3, 4]: fmt = NUMBER
        if col == 14: fmt = "0.0%"
        formula(ws.cell(30, col), value, fmt)
        ws.cell(30, col).fill = PatternFill("solid", fgColor=PALE_GREEN)
    month_operating = "=IF(V13>0,1,IF(V14>0,2,IF(V15>0,3,IF(V16>0,4,IF(V17>0,5,IF(V18>0,6,IF(V19>0,7,IF(V20>0,8,IF(V21>0,9,IF(V22>0,10,IF(V23>0,11,IF(V24>0,12,\">12\"))))))))))))"
    month_cumulative = "=IF(W13>0,1,IF(W14>0,2,IF(W15>0,3,IF(W16>0,4,IF(W17>0,5,IF(W18>0,6,IF(W19>0,7,IF(W20>0,8,IF(W21>0,9,IF(W22>0,10,IF(W23>0,11,IF(W24>0,12,\">12\"))))))))))))"
    formula(ws.cell(30, 15), month_operating)
    formula(ws.cell(30, 16), month_cumulative)
    for col in range(1, 17):
        ws.cell(30, col).fill = PatternFill("solid", fgColor=PALE_GREEN)

    line = LineChart()
    line.style = 13
    line.title = "Clientes activos por ciudad"
    line.y_axis.title = "Tenants activos"
    line.x_axis.title = "Mes"
    line.add_data(Reference(ws, min_col=8, max_col=12, min_row=12, max_row=24), titles_from_data=True)
    line.set_categories(Reference(ws, min_col=1, min_row=13, max_row=24))
    line.height = 8
    line.width = 15
    ws.add_chart(line, "A33")
    cash = LineChart()
    cash.style = 12
    cash.title = "Ingresos y resultado mensual"
    cash.y_axis.title = "COP"
    cash.x_axis.title = "Mes"
    cash.add_data(Reference(ws, min_col=14, min_row=12, max_row=24), titles_from_data=True)
    cash.add_data(Reference(ws, min_col=22, min_row=12, max_row=24), titles_from_data=True)
    cash.set_categories(Reference(ws, min_col=1, min_row=13, max_row=24))
    cash.height = 8
    cash.width = 15
    ws.add_chart(cash, "L33")
    ws.freeze_panes = "A13"
    return ws


def extend_dashboard(wb):
    ws = wb["Dashboard"]
    style_section(ws, 55, "Mercado, ROI y expansión", 12)
    entries = [
        ("ARPU comercial ponderado", "='Mercado TAM SAM SOM'!B21", CURRENCY),
        ("TAM nacional: ARR potencial", "='Mercado TAM SAM SOM'!E36", CURRENCY),
        ("SAM cinco ciudades: ARR potencial", "='Mercado TAM SAM SOM'!E37", CURRENCY),
        ("SOM año 1: MRR mes 12", "='Mercado TAM SAM SOM'!D38", CURRENCY),
        ("Resultado expansión 12 meses", "='ROI y expansión'!L30", CURRENCY),
        ("ROI sobre inversión de adquisición", "='ROI y expansión'!N30", "0.0%"),
        ("Control: altas Escala M1-M6", "='Proyección por plan'!B29", NUMBER),
        ("Control: altas Red M1-M6", "='Proyección por plan'!B30", NUMBER),
    ]
    for row, (label, value, fmt) in enumerate(entries, 56):
        set_cell(ws.cell(row, 1), label, kind="label", fill=GRAY)
        formula_link(ws.cell(row, 2), value, fmt)
        ws.merge_cells(start_row=row, start_column=2, end_row=row, end_column=3)
    ws.merge_cells("A65:L65")
    set_cell(ws["A65"], "TAM y ciudades fuera de Bogotá son estimaciones de mercado y priorización. El ROI excluye soporte, administración, impuestos y costos de desarrollo; no es utilidad neta contable.", kind="label", fill=PALE_YELLOW)
    ws["A65"].alignment = Alignment(wrap_text=True, vertical="center")
    ws.row_dimensions[65].height = 30


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
    create_commission_sheet(wb)
    create_market_sheet(wb)
    create_plan_projection_sheet(wb)
    create_roi_sheet(wb)
    extend_plan_profitability(wb)
    extend_dashboard(wb)
    wb.save(TARGET)
    print(TARGET)


if __name__ == "__main__":
    main()
