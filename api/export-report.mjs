import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const orange='#E85F3D', dark='#242C25', green='#2F7D4A', cream='#F7F6F2', line='#E7E2D8';
const header={fill:dark,font:{bold:true,color:'#FFFFFF'},verticalAlignment:'center'};
const title={fill:orange,font:{bold:true,color:'#FFFFFF',size:18},verticalAlignment:'center'};
const currency='"L "#,##0.00';

export async function buildSalesReport(data){
 const workbook=Workbook.create();
 const saleRows=data.sales.map(row=>[new Date(row.createdAt),row.saleNumber,row.pointName,row.userName,row.productName,row.quantity,row.unitPriceCents/100,row.subtotalCents/100]);
 const summary=workbook.worksheets.add('Resumen');const sales=workbook.worksheets.add('Ventas');const points=workbook.worksheets.add('Puntos de venta');
 for(const sheet of [summary,sales,points])sheet.showGridLines=false;

 summary.mergeCells('A1:H2');summary.getRange('A1:H2').values=[['Burrita · Reporte de ventas']];summary.getRange('A1:H2').format=title;
 summary.getRange('A3:H3').values=[[`Generado: ${data.generatedAt}`,'','','','','','','']];summary.getRange('A3:H3').format={fill:'#FFF0EB',font:{color:'#7A4B3D',italic:true}};
 summary.getRange('A5:B5').values=[['Ventas totales','Unidades vendidas']];summary.getRange('D5:E5').values=[['Reportes','Puntos con venta']];
 summary.getRange('A5:B5').format=header;summary.getRange('D5:E5').format=header;
 summary.getRange('A6').formulas=[["=SUM('Ventas'!$H$2:$H$5000)"]];summary.getRange('B6').formulas=[["=SUM('Ventas'!$F$2:$F$5000)"]];summary.getRange('D6').values=[[data.reportCount]];summary.getRange('E6').formulas=[["=COUNTIF('Puntos de venta'!$D$2:$D$500,\">0\")"]];
 summary.getRange('A6').format={fill:'#FFFFFF',font:{bold:true,color:orange,size:16},numberFormat:currency};summary.getRange('B6').format={fill:'#FFFFFF',font:{bold:true,color:green,size:16},numberFormat:'#,##0'};summary.getRange('D6:E6').format={fill:'#FFFFFF',font:{bold:true,color:dark,size:16},numberFormat:'#,##0'};
 summary.getRange('A9:B9').values=[['Día','Ingresos']];summary.getRange('A9:B9').format=header;
 const weekRows=data.week.length?data.week.map(row=>[row.day,row.revenueCents/100]):[['Sin ventas',0]];summary.getRangeByIndexes(9,0,weekRows.length,2).values=weekRows;summary.getRange(`B10:B${9+weekRows.length}`).format.numberFormat=currency;
 const trend=summary.charts.add('bar',summary.getRange(`A9:B${9+weekRows.length}`));trend.title='Ingresos de los últimos 7 días';trend.hasLegend=false;trend.yAxis={numberFormatCode:currency};trend.setPosition('D9','H22');

 sales.getRange('A1:H1').values=[['Fecha y hora','Reporte','Punto de venta','Usuario','Producto','Cantidad','Precio unitario','Subtotal']];sales.getRange('A1:H1').format=header;
 if(saleRows.length)sales.getRangeByIndexes(1,0,saleRows.length,8).values=saleRows;
 sales.getRange(`A2:A${Math.max(2,saleRows.length+1)}`).format.numberFormat='yyyy-mm-dd hh:mm';sales.getRange(`F2:F${Math.max(2,saleRows.length+1)}`).format.numberFormat='#,##0';sales.getRange(`G2:H${Math.max(2,saleRows.length+1)}`).format.numberFormat=currency;
 if(saleRows.length)sales.tables.add(`A1:H${saleRows.length+1}`,true,'VentasDetalle').style='TableStyleMedium2';sales.freezePanes.freezeRows(1);

 points.getRange('A1:E1').values=[['Punto de venta','Estado','Unidades vendidas','Ingresos','Inventario actual']];points.getRange('A1:E1').format=header;
 const pointRows=data.points.map(row=>[row.name,row.status==='active'?'Activo':'Inactivo',row.units,row.revenueCents/100,row.stock]);
 if(pointRows.length)points.getRangeByIndexes(1,0,pointRows.length,5).values=pointRows;
 points.getRange(`C2:C${Math.max(2,pointRows.length+1)}`).format.numberFormat='#,##0';points.getRange(`D2:D${Math.max(2,pointRows.length+1)}`).format.numberFormat=currency;points.getRange(`E2:E${Math.max(2,pointRows.length+1)}`).format.numberFormat='#,##0';
 if(pointRows.length){points.tables.add(`A1:E${pointRows.length+1}`,true,'ResumenPuntos').style='TableStyleMedium4';const chart=points.charts.add('bar',{chartType:'bar',title:'Ingresos por punto de venta',hasLegend:false});const series=chart.series.add('Ingresos');series.categoryFormula=`'Puntos de venta'!$A$2:$A$${pointRows.length+1}`;series.formula=`'Puntos de venta'!$D$2:$D$${pointRows.length+1}`;series.fill=green;chart.yAxis={numberFormatCode:currency};chart.setPosition('G2','N18');}points.freezePanes.freezeRows(1);

 summary.getRange('A1:H24').format.font={name:'Aptos'};const salesUsed=sales.getUsedRange();const pointsUsed=points.getUsedRange();if(salesUsed)salesUsed.format.font={name:'Aptos'};if(pointsUsed)pointsUsed.format.font={name:'Aptos'};
 summary.getRange('A:H').format.columnWidth=16;summary.getRange('A:A').format.columnWidth=22;sales.getRange('A:A').format.columnWidth=20;sales.getRange('B:B').format.columnWidth=18;sales.getRange('C:E').format.columnWidth=24;sales.getRange('F:H').format.columnWidth=16;points.getRange('A:A').format.columnWidth=25;points.getRange('B:E').format.columnWidth=17;
 summary.getRange('A1:H24').format.borders={preset:'outside',style:'thin',color:line};summary.freezePanes.freezeRows(3);
 return workbook;
}

export async function exportSalesReport(data){const workbook=await buildSalesReport(data);return SpreadsheetFile.exportXlsx(workbook)}
