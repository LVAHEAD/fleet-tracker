/* Песочница: «C» подсвечивается розовым, если есть не пройденная точка в Швеции (SE) или Норвегии (NO), а цепи не отмечены.
   Страна — по коду значка точки (NO17, SE25). Пока цветная метка и задержка — как в аппе v3.202; задержка раскрытия цветов — 1 сек. */
(function(){
  window.MARK_SEG_DELAY=1000;
  function pass(){
    document.querySelectorAll("#fleet-tbody > tr").forEach(function(tr){
      var cell=tr.querySelector(".chain-cell"); if(!cell)return;
      var need=false;
      tr.querySelectorAll(".cc-badge.cc-pt-flag").forEach(function(b){
        if(b.closest(".status-cell"))return;
        var w=b.closest(".target-wrap"); if(w&&w.classList.contains("pt-done"))return;
        if(/^(NO|SE)/i.test(b.textContent.trim())) need=true;
      });
      cell.classList.toggle("chain-need",need);
    });
  }
  var q; new MutationObserver(function(){clearTimeout(q);q=setTimeout(pass,40);}).observe(document.getElementById("fleet-tbody"),{childList:true,subtree:true});
  document.addEventListener("change",function(){setTimeout(pass,60);},true); setInterval(pass,1500); pass();
  var bar=document.createElement("div"); bar.id="cn-bar";
  bar.innerHTML='<b>«C» без цепей, цель SE / NO:</b>'+[["нет подсветки",0],["розовый чекбокс",1],["розовая ячейка + контур",2]].map(function(o,i){return '<label><input type=radio name=cn value='+o[1]+(i===1?' checked':'')+'> '+o[0]+'</label>';}).join('');
  document.body.appendChild(bar);
  function set(v){document.body.classList.remove("cn-1","cn-2"); if(+v)document.body.classList.add("cn-"+v);}
  bar.addEventListener("change",function(e){set(e.target.value);}); set(1);
})();
