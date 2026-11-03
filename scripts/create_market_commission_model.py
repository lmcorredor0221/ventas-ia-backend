from pathlib import Path

from openpyxl import load_workbook
from openpyxl.styles import Alignment, PatternFill

from create_consolidated_financial_model import (
    BLACK,
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


TARGET = Path(__file__).resolve().parents[1] / "docs" / "Dashboard-financiero-VIA-2026-10-21-mercado-y-comisiones.xlsx"
CURRENCY = 'COP #,##0;[Red](COP #,##0);-'
NUMBER = '#,##0.0;[Red](#,##0.0);-'


def create_commission_sheet(wb):
    if "Comisiones" in wb.sheetnames:
        del wb["Comisiones"]
    ws = wb.create_sheet("Comisiones", 2)
    ws.sheet_view.showGridLines = False
    for col, width in {
        "A": 16, "B": 16, "C": 13, "D": 14, "E": 14, "F": 14, "G": 14,
        "H": 14, "I": 17, "J": 20, "K": 20, "L": 19, "M": 20, "N": 19,
        "O": 17, "P": 17, "Q": 24,
    }.items():
        ws.column_dimensions[col].width = width

    style_title(ws, ws.cell(1, 1), "VIA | Comisiones de vendedores por plan", 17)
    style_subtitle(
        ws,
        2,
        "La comisión se causa solo tras un cobro exitoso, una suscripción activa y el onboarding completado. Los pagos de los meses 2 a 5 se suspenden inmediatamente si el tenant deja de estar activo y al día.",
        17,
    )
    style_section(ws, 4, "Supuestos editables", 17)
    inputs = [
        ("Churn mensual", 0.05, "0.0%", "Supuesto del caso de negocio. Afecta el pago esperado de comisiones de continuidad."),
        ("Comisión Pro - mes 1", 50000, CURRENCY, "Esquema solicitado. Pago contra cobro y activación completa."),
        ("Comisión Pro - mes 2", 20000, CURRENCY, "Pago condicionado a renovación cobrada y tenant activo."),
        ("Comisión Pro - meses 3 a 5", 10000, CURRENCY, "Se aplica individualmente en cada renovación cobrada de los meses 3, 4 y 5."),
    ]
    for row, (label, value, fmt, note) in enumerate(inputs, 5):
        set_cell(ws.cell(row, 1), label, kind="label", fill=GRAY)
        set_cell(ws.cell(row, 2), value, kind="input", fill=YELLOW, num_format=fmt, comment=note)
        set_cell(ws.cell(row, 3), note, kind="label")
        ws.merge_cells(start_row=row, start_column=3, end_row=row, end_column=17)

    style_section(ws, 11, "Escalamiento proporcional de la comisión", 17)
    headers = [
        "Plan", "Precio VIA", "Mix", "Mes 1", "Mes 2", "Mes 3", "Mes 4", "Mes 5", "Máximo bruto", "Comisión esperada 5m", "Ingreso esperado 5m", "Comisión / ingreso 5m", "Ingreso esperado 12m", "Comisión / ingreso 12m", "Reserva DS / mes", "Recaudo / mes", "Contribución esperada 5m antes de infraestructura",
    ]
    set_header(ws, 12, headers)
    for row, plan_row in enumerate(range(5, 11), 13):
        formula_link(ws.cell(row, 1), f"=Planes!A{plan_row}")
        formula_link(ws.cell(row, 2), f"=Planes!C{plan_row}", CURRENCY)
        formula_link(ws.cell(row, 3), f"='Modelo consolidado'!D{row + 1}", "0.0%")
        formula(ws.cell(row, 4), f"=ROUND($B$6*B{row}/Planes!$C$8,-3)", CURRENCY)
        formula(ws.cell(row, 5), f"=ROUND($B$7*B{row}/Planes!$C$8,-3)", CURRENCY)
        formula(ws.cell(row, 6), f"=ROUND($B$8*B{row}/Planes!$C$8,-3)", CURRENCY)
        formula(ws.cell(row, 7), f"=F{row}", CURRENCY)
        formula(ws.cell(row, 8), f"=F{row}", CURRENCY)
        formula(ws.cell(row, 9), f"=SUM(D{row}:H{row})", CURRENCY)
        formula(ws.cell(row, 10), f"=D{row}+E{row}*(1-$B$5)+F{row}*(1-$B$5)^2+G{row}*(1-$B$5)^3+H{row}*(1-$B$5)^4", CURRENCY)
        formula(ws.cell(row, 11), f"=B{row}*(1+(1-$B$5)+(1-$B$5)^2+(1-$B$5)^3+(1-$B$5)^4)", CURRENCY)
        formula(ws.cell(row, 12), f"=IFERROR(J{row}/K{row},0)", "0.0%")
        formula(ws.cell(row, 13), f"=B{row}*(1+(1-$B$5)+(1-$B$5)^2+(1-$B$5)^3+(1-$B$5)^4+(1-$B$5)^5+(1-$B$5)^6+(1-$B$5)^7+(1-$B$5)^8+(1-$B$5)^9+(1-$B$5)^10+(1-$B$5)^11)", CURRENCY)
        formula(ws.cell(row, 14), f"=IFERROR(J{row}/M{row},0)", "0.0%")
        formula_link(ws.cell(row, 15), f"=Planes!F{plan_row}", CURRENCY)
        formula_link(ws.cell(row, 16), f"=Planes!N{plan_row}", CURRENCY)
        formula(ws.cell(row, 17), f"=K{row}-J{row}-(O{row}+P{row})*(1+(1-$B$5)+(1-$B$5)^2+(1-$B$5)^3+(1-$B$5)^4)", CURRENCY)

    total = 19
    set_cell(ws.cell(total, 1), "Resultado ponderado", kind="label", fill=PALE_GREEN)
    for col in range(2, 18):
        letter = chr(64 + col)
        if col == 3:
            formula(ws.cell(total, col), f"=SUM({letter}13:{letter}18)", "0.0%")
        elif col == 12:
            formula(ws.cell(total, col), "=IFERROR(J19/K19,0)", "0.0%")
        elif col == 14:
            formula(ws.cell(total, col), "=IFERROR(J19/M19,0)", "0.0%")
        elif col in [4, 5, 6, 7, 8]:
            formula(ws.cell(total, col), f"=SUMPRODUCT({letter}13:{letter}18,$C$13:$C$18)", CURRENCY)
        elif col in [2, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 16, 17]:
            formula(ws.cell(total, col), f"=SUMPRODUCT({letter}13:{letter}18,$C$13:$C$18)", CURRENCY)
        else:
            formula(ws.cell(total, col), f"=SUM({letter}13:{letter}18)", CURRENCY)
        ws.cell(total, col).fill = PatternFill("solid", fgColor=PALE_GREEN)
    ws.cell(total, 1).fill = PatternFill("solid", fgColor=PALE_GREEN)
    ws.merge_cells("A22:Q22")
    set_cell(ws["A22"], "La propuesta escala proporcionalmente desde Pro y redondea a COP 1.000. El máximo Pro es COP 100.000, pero el pago esperado es menor si ocurre churn porque las renovaciones no se pagan sin suscripción activa y al día.", kind="label", fill=PALE_YELLOW)
    ws["A22"].alignment = Alignment(wrap_text=True, vertical="center")
    ws.row_dimensions[22].height = 30
    ws.freeze_panes = "A13"
    ws.auto_filter.ref = "A12:Q18"
    return ws


def capacity_formula(active_cell):
    return (
        f"=IF({active_cell}*'Modelo consolidado'!$E$20/Planes!$B$8>MAX(Capacidad!$A$5:$A$11),"
        f"INDEX(Capacidad!$P$5:$P$11,ROWS(Capacidad!$P$5:$P$11))*ROUNDUP({active_cell}*'Modelo consolidado'!$E$20/Planes!$B$8/MAX(Capacidad!$A$5:$A$11),0),"
        f"INDEX(Capacidad!$P$5:$P$11,MATCH(MAX(10,{active_cell}*'Modelo consolidado'!$E$20/Planes!$B$8),Capacidad!$A$5:$A$11,1)))"
    )


def create_sales_sheet(wb):
    if "Ventas vendedores" in wb.sheetnames:
        del wb["Ventas vendedores"]
    ws = wb.create_sheet("Ventas vendedores", 3)
    ws.sheet_view.showGridLines = False
    for col, width in {
        "A": 14, "B": 9, "C": 12, "D": 16, "E": 15, "F": 16, "G": 13, "H": 15,
        "I": 18, "J": 15, "K": 15, "L": 15, "M": 15, "N": 15, "O": 18, "P": 15,
        "Q": 15, "R": 20, "S": 19, "T": 17, "U": 17, "V": 18,
    }.items():
        ws.column_dimensions[col].width = width

    style_title(ws, ws.cell(1, 1), "VIA | Escenarios de ventas por vendedor", 22)
    style_subtitle(ws, 2, "Escenarios por cohorte de 12 meses. Los cobros y comisiones se calculan únicamente para clientes activos; no incluyen marketing, soporte, impuestos ni administración.", 22)
    style_section(ws, 4, "Entradas de escenarios", 22)
    set_header(ws, 5, ["Escenario", "Vendedores", "Altas pagadas por vendedor / mes", "Altas nuevas / mes", "Altas anuales", "Lectura"])
    scenarios = [
        ("Piloto", 1, 3, "Validar discurso, activación y churn con una cuota de tres altas pagadas al mes."),
        ("Base", 2, 6, "Dos vendedores con seis altas pagadas por vendedor al mes."),
        ("Escala", 2, 10, "Dos vendedores maduros con diez altas pagadas por vendedor al mes."),
    ]
    for row, (name, sellers, monthly, note) in enumerate(scenarios, 6):
        set_cell(ws.cell(row, 1), name, kind="label", fill=GRAY)
        set_cell(ws.cell(row, 2), sellers, kind="input", fill=YELLOW, num_format='#,##0')
        set_cell(ws.cell(row, 3), monthly, kind="input", fill=YELLOW, num_format='#,##0')
        formula(ws.cell(row, 4), f"=B{row}*C{row}", '#,##0')
        formula(ws.cell(row, 5), f"=D{row}*12", '#,##0')
        set_cell(ws.cell(row, 6), note, kind="label")
    ws.merge_cells("A10:F10")
    set_cell(ws["A10"], "Las altas se contabilizan después del primer cobro acreditado y la activación completa. Una demo, lead o tenant moroso no genera comisión.", kind="label", fill=PALE_YELLOW)

    style_section(ws, 12, "Flujo mensual por cohorte", 22)
    headers = [
        "Escenario", "Mes", "Vendedores", "Altas / vendedor", "Altas pagadas", "Activos inicio", "Churn", "Activos fin", "Ingresos", "M1", "M2", "M3", "M4", "M5", "Comisiones", "DeepSeek", "Mercado Pago", "Infraestructura", "Costos antes provisión", "Provisión 10%", "Resultado", "Resultado acumulado",
    ]
    set_header(ws, 13, headers)
    starts = []
    row = 14
    for scenario_index, (name, _, _, _) in enumerate(scenarios, 6):
        starts.append((name, row, scenario_index))
        for month in range(1, 13):
            r = row
            set_cell(ws.cell(r, 1), name, kind="label")
            set_cell(ws.cell(r, 2), month, kind="input", fill=YELLOW, num_format='0')
            formula(ws.cell(r, 3), f"=$B${scenario_index}", '#,##0')
            formula(ws.cell(r, 4), f"=$C${scenario_index}", '#,##0')
            formula(ws.cell(r, 5), f"=C{r}*D{r}", '#,##0')
            if month == 1:
                formula(ws.cell(r, 6), "=0", NUMBER)
                formula(ws.cell(r, 22), f"=U{r}", CURRENCY)
            else:
                formula(ws.cell(r, 6), f"=H{r - 1}", NUMBER)
                formula(ws.cell(r, 22), f"=V{r - 1}+U{r}", CURRENCY)
            formula(ws.cell(r, 7), f"=F{r}*Comisiones!$B$5", NUMBER)
            formula(ws.cell(r, 8), f"=F{r}-G{r}+E{r}", NUMBER)
            formula(ws.cell(r, 9), f"=H{r}*'Modelo consolidado'!$F$20", CURRENCY)
            formula(ws.cell(r, 10), f"=E{r}*Comisiones!$D$19", CURRENCY)
            formula(ws.cell(r, 11), f"=IF(B{r}<2,0,E{r-1}*(1-Comisiones!$B$5)*Comisiones!$E$19)", CURRENCY)
            formula(ws.cell(r, 12), f"=IF(B{r}<3,0,E{r-2}*(1-Comisiones!$B$5)^2*Comisiones!$F$19)", CURRENCY)
            formula(ws.cell(r, 13), f"=IF(B{r}<4,0,E{r-3}*(1-Comisiones!$B$5)^3*Comisiones!$G$19)", CURRENCY)
            formula(ws.cell(r, 14), f"=IF(B{r}<5,0,E{r-4}*(1-Comisiones!$B$5)^4*Comisiones!$H$19)", CURRENCY)
            formula(ws.cell(r, 15), f"=SUM(J{r}:N{r})", CURRENCY)
            formula(ws.cell(r, 16), f"=H{r}*'Modelo consolidado'!$H$20", CURRENCY)
            formula(ws.cell(r, 17), f"=H{r}*'Modelo consolidado'!$G$20", CURRENCY)
            formula(ws.cell(r, 18), capacity_formula(f"H{r}"), CURRENCY)
            formula(ws.cell(r, 19), f"=SUM(O{r}:R{r})", CURRENCY)
            formula(ws.cell(r, 20), f"=S{r}*'Modelo consolidado'!$B$5", CURRENCY)
            formula(ws.cell(r, 21), f"=I{r}-S{r}-T{r}", CURRENCY)
            row += 1

    style_section(ws, 52, "Resumen anual y punto de equilibrio", 22)
    set_header(ws, 53, ["Escenario", "Altas anuales", "Activos mes 12", "Ingresos 12m", "Comisiones 12m", "CAC comisión por alta", "DeepSeek 12m", "Recaudo 12m", "Infraestructura 12m", "Provisión 12m", "Resultado 12m", "Meses con resultado positivo", "Resultado acumulado", "Lectura"])
    for out_row, (name, start, input_row) in enumerate(starts, 54):
        end = start + 11
        set_cell(ws.cell(out_row, 1), name, kind="label", fill=PALE_GREEN)
        formula(ws.cell(out_row, 2), f"=SUM(E{start}:E{end})", '#,##0')
        formula(ws.cell(out_row, 3), f"=H{end}", NUMBER)
        formula(ws.cell(out_row, 4), f"=SUM(I{start}:I{end})", CURRENCY)
        formula(ws.cell(out_row, 5), f"=SUM(O{start}:O{end})", CURRENCY)
        formula(ws.cell(out_row, 6), f"=IFERROR(E{out_row}/B{out_row},0)", CURRENCY)
        formula(ws.cell(out_row, 7), f"=SUM(P{start}:P{end})", CURRENCY)
        formula(ws.cell(out_row, 8), f"=SUM(Q{start}:Q{end})", CURRENCY)
        formula(ws.cell(out_row, 9), f"=SUM(R{start}:R{end})", CURRENCY)
        formula(ws.cell(out_row, 10), f"=SUM(T{start}:T{end})", CURRENCY)
        formula(ws.cell(out_row, 11), f"=SUM(U{start}:U{end})", CURRENCY)
        formula(ws.cell(out_row, 12), f"=COUNTIF(U{start}:U{end},\">0\")", '#,##0')
        formula(ws.cell(out_row, 13), f"=V{end}", CURRENCY)
        set_cell(ws.cell(out_row, 14), "Resultado antes de marketing, soporte, impuestos y administración.", kind="label")

    ws.merge_cells("A59:N59")
    set_cell(ws["A59"], "Punto de equilibrio práctico: el escenario Base debe cubrir desde el mes 1 la infraestructura mínima y, durante el piloto, confirmar activación, cobro y churn. La métrica decisiva es comisión pagada por alta activa, no leads ni demos.", kind="label", fill=PALE_YELLOW)
    ws["A59"].alignment = Alignment(wrap_text=True, vertical="center")
    ws.row_dimensions[59].height = 30
    ws.freeze_panes = "A14"
    ws.auto_filter.ref = "A13:V49"
    return ws


def extend_dashboard(wb):
    ws = wb["Dashboard"]
    style_section(ws, 47, "Canal de vendedores y comisiones", 12)
    entries = [
        ("CAC comisión Pro esperado 5 meses", "=Comisiones!J16", CURRENCY),
        ("Comisión Pro máxima", "=Comisiones!I16", CURRENCY),
        ("Piloto: resultado anual", "='Ventas vendedores'!K54", CURRENCY),
        ("Base: resultado anual", "='Ventas vendedores'!K55", CURRENCY),
        ("Escala: resultado anual", "='Ventas vendedores'!K56", CURRENCY),
    ]
    for row, (label, value, fmt) in enumerate(entries, 48):
        set_cell(ws.cell(row, 1), label, kind="label", fill=GRAY)
        formula_link(ws.cell(row, 2), value, fmt)
        ws.merge_cells(start_row=row, start_column=2, end_row=row, end_column=3)


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
    create_sales_sheet(wb)
    extend_dashboard(wb)
    wb.save(TARGET)
    print(TARGET)


if __name__ == "__main__":
    main()
