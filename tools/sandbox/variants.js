/* Песочница: задержка раскрытия цветов при наведении на плашку под клиентом. В аппе сейчас ~150 мс (window.MARK_SEG_DELAY не задан). */
(function(){
  var bar=document.createElement("div"); bar.id="mkd-bar";
  bar.innerHTML='<b>Цвета при наведении через:</b>'+[["0,15 с (как в аппе)",150],["1 сек",1000],["2 сек",2000],["3 сек",3000]].map(function(o,i){return '<label><input type=radio name=mkd value='+o[1]+(i===1?' checked':'')+'> '+o[0]+'</label>';}).join('');
  document.body.appendChild(bar);
  window.MARK_SEG_DELAY=1000;
  bar.addEventListener("change",function(e){window.MARK_SEG_DELAY=Number(e.target.value);});
})();
