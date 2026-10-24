/* Песочница: дата точки ① (Delivery первой строки трипа) в плашке под клиентом, формат ДД.ММ.
   В аппе пока не сделано. Дату берём из .delivery-input первой точки, разбор — parseDeliveryWindow аппы. */
(function(){
  function pad(n){return (n<10?"0":"")+n;}
  function pass(){
    document.querySelectorAll("#fleet-tbody > tr").forEach(function(tr){
      var m=tr.querySelector(".cl-mark"), d=tr.querySelector(".delivery-input"); if(!m||!d)return;
      var t=""; try{ var w=d.value.trim()?parseDeliveryWindow(d.value):null; var s=w&&(w.start||w.end); if(s)t=pad(s.getDate())+"."+pad(s.getMonth()+1);}catch(e){}
      if(m.textContent!==t) m.textContent=t;
    });
  }
  var q; new MutationObserver(function(){clearTimeout(q);q=setTimeout(pass,40);}).observe(document.getElementById("fleet-tbody"),{childList:true,subtree:true});
  document.addEventListener("change",function(){setTimeout(pass,60);},true); setInterval(pass,1500); pass();
  var bar=document.createElement("div"); bar.id="mk-bar";
  bar.innerHTML='<b>Плашка:</b>'+['как в аппе (11 px, без даты)','выше, 18 px','выше, 22 px'].map(function(t,i){return '<label><input type=radio name=mk value='+i+(i===1?' checked':'')+'> '+t+'</label>';}).join('');
  document.body.appendChild(bar);
  function set(v){document.body.classList.remove("mk-0","mk-1","mk-2"); document.body.classList.add("mk-"+v);
    document.querySelectorAll(".cl-mark").forEach(function(m){m.style.fontSize=v==="0"?"0":"";}); }
  bar.addEventListener("change",function(e){set(e.target.value);}); set("1");
})();
