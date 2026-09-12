(function(){
  "use strict";

  // ============================================================
  // EL RESERO — lógica de la app (Supabase: Auth + Postgres + RLS)
  // ============================================================
  // Reemplaza al artifact de claude.ai. La identidad y los permisos ahora
  // son reales: cada persona inicia sesión con su email/contraseña propios
  // (Supabase Auth) y la base de datos (Postgres, con Row Level Security)
  // es la que decide qué puede ver o hacer cada quien — no el código de acá.
  //
  // Quien se registra solo queda como "empleado" e INACTIVO hasta que un
  // admin (Juan) lo active desde Configuración → Personas. Así es como Juan
  // controla los permisos de cada usuario nuevo.

  var supabase = window.supabase.createClient(
    window.EL_RESERO_CONFIG.SUPABASE_URL,
    window.EL_RESERO_CONFIG.SUPABASE_ANON_KEY
  );

  var APP = {
    session:null, profile:null, isAdmin:false, ready:false,
    profiles:[], productos:[], ventas:[], clientes:[], ajustes:[],
    gastos:[], cheques:[], inversiones:[], inversionesHistorial:[],
    config:null, objetivos:null,
    currentSection:'panel',
    panelPeriod:currentPeriod(), finPeriod:currentPeriod(), statsPeriod:currentPeriod(),
    editingProductId:null, editingInvId:null, viewingHistorialInvId:null,
    confirming:{}, ajusteFiltro:'', trazaFiltro:'',
    authMode:'login', authBusy:false
  };

  var NAV_ITEMS = [
    {id:'panel', label:'Panel'},
    {id:'ventas', label:'Ventas'},
    {id:'stock', label:'Stock'},
    {id:'clientes', label:'Clientes'},
    {id:'estadisticas', label:'Estadísticas'}
  ];
  var NAV_ADMIN = [
    {id:'finanzas', label:'Finanzas'},
    {id:'bancos', label:'Bancos y cheques'},
    {id:'config', label:'Configuración'}
  ];
  var SECTION_LABELS = {
    panel:'Panel', ventas:'Ventas', stock:'Stock', clientes:'Clientes', estadisticas:'Estadísticas',
    finanzas:'Finanzas', bancos:'Bancos y cheques', config:'Configuración'
  };

  // ---------- utils ----------
  function $(sel, root){ return (root||document).querySelector(sel); }
  function $all(sel, root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }
  function pad(n){ return String(n).padStart(2,'0'); }
  function esc(s){
    return String(s==null?'':s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function todayISO(){ var d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function currentPeriod(){ var d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1); }
  function periodLabel(p){
    var parts=p.split('-'); var meses=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    return meses[parseInt(parts[1],10)-1]+' '+parts[0];
  }
  function fmtMoney(n){ n=Number(n)||0; return '$'+Math.round(n).toLocaleString('es-AR'); }
  function fmtKg(n){
    n=Number(n)||0;
    return n.toLocaleString('es-AR',{minimumFractionDigits:(Math.round(n*100)%100===0?0:1), maximumFractionDigits:2})+' kg';
  }
  function nombrePorId(id){
    var p = APP.profiles.find(function(x){ return x.id===id; });
    return p ? p.nombre : '—';
  }
  function nombreProducto(id){
    var p = APP.productos.find(function(x){ return x.id===id; });
    return p ? p.nombre : '—';
  }

  function toast(msg, type){
    var el=document.createElement('div');
    el.className='toast'+(type?' '+type:'');
    el.textContent=msg;
    $('#toasts').appendChild(el);
    setTimeout(function(){ el.remove(); }, 4200);
  }
  function showFieldError(sel, msg){
    var el=$(sel); if(!el) return;
    el.textContent=msg; el.hidden=false;
  }
  function hideFieldError(sel){ var el=$(sel); if(el){ el.hidden=true; el.textContent=''; } }

  function traducirErrorAuth(msg){
    msg = String(msg||'');
    if(/invalid login credentials/i.test(msg)) return 'Email o contraseña incorrectos.';
    if(/email not confirmed/i.test(msg)) return 'Todavía no confirmaste tu email — revisá tu casilla de correo.';
    if(/user already registered/i.test(msg)) return 'Ya existe una cuenta con ese email — probá iniciar sesión.';
    if(/password should be at least/i.test(msg)) return 'La contraseña es demasiado corta (mínimo 6 caracteres).';
    if(/rate limit/i.test(msg)) return 'Demasiados intentos — esperá un momento y volvé a intentar.';
    return msg || 'Ocurrió un error inesperado.';
  }

  // ============================================================
  // AUTENTICACIÓN
  // ============================================================

  function showAuthGate(){ $('#authGate').hidden=false; $('#appShell').hidden=true; }
  function hideAuthGate(){ $('#authGate').hidden=true; $('#appShell').hidden=false; }

  function setAuthMode(mode){ APP.authMode=mode; renderAuthGate(); }

  function renderAuthGate(){
    var card = $('#authGateCard');
    if(APP.authMode==='pending'){
      var nombre = APP.profile ? APP.profile.nombre : '';
      card.innerHTML =
        '<h2>Cuenta pendiente de aprobación</h2>'+
        '<div class="sub">Hola'+(nombre?', '+esc(nombre):'')+'. Tu cuenta ya existe pero todavía no fue activada. Avisale a Juan para que te dé acceso desde Configuración → Personas.</div>'+
        '<div class="form-row">'+
          '<button type="button" class="btn btn-primary" onclick="ElResero.reintentarAprobacion()">Ya me aprobaron, reintentar</button>'+
          '<button type="button" class="btn" onclick="ElResero.cerrarSesion()">Cerrar sesión</button>'+
        '</div>';
      return;
    }

    var isLogin = APP.authMode!=='signup';
    card.innerHTML =
      '<h2>El Resero</h2>'+
      '<div class="sub">Control de gestión — iniciá sesión o creá tu cuenta.</div>'+
      '<div class="auth-toggle">'+
        '<button type="button" class="'+(isLogin?'active':'')+'" onclick="ElResero.setAuthMode(\'login\')">Iniciar sesión</button>'+
        '<button type="button" class="'+(!isLogin?'active':'')+'" onclick="ElResero.setAuthMode(\'signup\')">Crear cuenta</button>'+
      '</div>'+
      (isLogin ? formLogin() : formSignup());

    if(isLogin){
      $('#loginForm').onsubmit=onSubmitLogin;
    } else {
      $('#signupForm').onsubmit=onSubmitSignup;
    }
  }

  function formLogin(){
    return '<form id="loginForm">'+
      '<div class="field" style="margin-bottom:10px;"><label for="loginEmail">Email</label><input id="loginEmail" type="email" required autocomplete="username"></div>'+
      '<div class="field" style="margin-bottom:12px;"><label for="loginPassword">Contraseña</label><input id="loginPassword" type="password" required autocomplete="current-password"></div>'+
      '<div class="field-error" id="loginError" hidden></div>'+
      '<button type="submit" class="btn btn-primary btn-block">Entrar</button>'+
    '</form>';
  }
  function formSignup(){
    return '<form id="signupForm">'+
      '<div class="field" style="margin-bottom:10px;"><label for="suNombre">Tu nombre</label><input id="suNombre" required placeholder="Ej: María"></div>'+
      '<div class="field" style="margin-bottom:10px;"><label for="suEmail">Email</label><input id="suEmail" type="email" required autocomplete="username"></div>'+
      '<div class="field" style="margin-bottom:10px;"><label for="suPassword">Contraseña</label><input id="suPassword" type="password" required minlength="6" autocomplete="new-password"></div>'+
      '<div class="field" style="margin-bottom:12px;"><label for="suPassword2">Repetir contraseña</label><input id="suPassword2" type="password" required minlength="6" autocomplete="new-password"></div>'+
      '<div class="field-error" id="signupError" hidden></div>'+
      '<button type="submit" class="btn btn-primary btn-block">Crear cuenta</button>'+
      '<div class="hint" style="color:var(--ink-muted); font-size:12px; margin-top:10px;">Tu cuenta queda pendiente de aprobación hasta que Juan te active.</div>'+
    '</form>';
  }

  async function onSubmitLogin(e){
    e.preventDefault();
    if(APP.authBusy) return;
    hideFieldError('#loginError');
    var email=$('#loginEmail').value.trim(), password=$('#loginPassword').value;
    APP.authBusy=true;
    try{
      var res = await supabase.auth.signInWithPassword({email:email, password:password});
      if(res.error){ showFieldError('#loginError', traducirErrorAuth(res.error.message)); }
    }catch(err){ showFieldError('#loginError', traducirErrorAuth(err&&err.message)); }
    APP.authBusy=false;
  }

  async function onSubmitSignup(e){
    e.preventDefault();
    if(APP.authBusy) return;
    hideFieldError('#signupError');
    var nombre=$('#suNombre').value.trim();
    var email=$('#suEmail').value.trim();
    var password=$('#suPassword').value;
    var password2=$('#suPassword2').value;
    if(!nombre) return showFieldError('#signupError','Ingresá tu nombre.');
    if(password!==password2) return showFieldError('#signupError','Las contraseñas no coinciden.');
    APP.authBusy=true;
    try{
      var res = await supabase.auth.signUp({ email:email, password:password, options:{ data:{ nombre:nombre } } });
      if(res.error){ showFieldError('#signupError', traducirErrorAuth(res.error.message)); }
      else{
        APP.authMode='pending';
        APP.profile={nombre:nombre};
        renderAuthGate();
      }
    }catch(err){ showFieldError('#signupError', traducirErrorAuth(err&&err.message)); }
    APP.authBusy=false;
  }

  async function cerrarSesion(){
    try{ await supabase.auth.signOut(); }catch(e){}
    APP.profile=null; APP.isAdmin=false; APP.ready=false;
    APP.authMode='login';
    renderAuthGate();
    showAuthGate();
  }

  async function reintentarAprobacion(){ await checkProfileAndProceed(); }

  async function checkProfileAndProceed(){
    if(!APP.session){ APP.authMode='login'; renderAuthGate(); showAuthGate(); return; }
    var uid = APP.session.user.id;
    try{
      var res = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
      if(res.error || !res.data){
        APP.profile=null; APP.authMode='pending'; renderAuthGate(); showAuthGate(); return;
      }
      APP.profile = res.data;
      APP.isAdmin = res.data.rol==='admin';
      if(!res.data.activo){
        APP.authMode='pending'; renderAuthGate(); showAuthGate(); return;
      }
      hideAuthGate();
      await loadAllData();
      buildNav();
      renderRoleBadge();
      renderCurrentUserBadge();
      APP.ready=true;
      showSection(APP.currentSection||'panel');
    }catch(err){
      toast('No se pudo verificar tu cuenta. Recargá la página.', 'danger');
    }
  }

  async function initAuth(){
    var sres = await supabase.auth.getSession();
    APP.session = sres.data ? sres.data.session : null;
    supabase.auth.onAuthStateChange(function(event, session){
      APP.session = session;
      if(event==='SIGNED_OUT'){
        APP.profile=null; APP.isAdmin=false; APP.ready=false;
        APP.authMode='login'; renderAuthGate(); showAuthGate();
        return;
      }
      checkProfileAndProceed();
    });
    if(APP.session){ await checkProfileAndProceed(); }
    else{ renderAuthGate(); showAuthGate(); }
  }

  // ============================================================
  // CARGA DE DATOS (sin realtime — se recarga después de cada escritura)
  // ============================================================

  async function loadAllData(){
    var basicas = await Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('productos').select('*'),
      supabase.from('ventas').select('*').order('ts',{ascending:false}).limit(500),
      supabase.from('clientes').select('*'),
      supabase.from('ajustes_stock').select('*'),
      supabase.from('objetivos').select('*').eq('id',1).maybeSingle()
    ]);
    APP.profiles = basicas[0].data || [];
    APP.productos = basicas[1].data || [];
    APP.ventas = basicas[2].data || [];
    APP.clientes = basicas[3].data || [];
    APP.ajustes = basicas[4].data || [];
    APP.objetivos = basicas[5].data || null;

    if(APP.isAdmin){
      var admin = await Promise.all([
        supabase.from('gastos').select('*'),
        supabase.from('cheques').select('*'),
        supabase.from('inversiones').select('*'),
        supabase.from('inversiones_historial').select('*'),
        supabase.from('config').select('*').eq('id',1).maybeSingle()
      ]);
      APP.gastos = admin[0].data || [];
      APP.cheques = admin[1].data || [];
      APP.inversiones = admin[2].data || [];
      APP.inversionesHistorial = admin[3].data || [];
      APP.config = admin[4].data || null;
    }
  }

  async function reload(){
    var p1 = supabase.from('profiles').select('*').then(function(r){ APP.profiles=r.data||[]; });
    var p2 = supabase.from('productos').select('*').then(function(r){ APP.productos=r.data||[]; });
    var p3 = supabase.from('ventas').select('*').order('ts',{ascending:false}).limit(500).then(function(r){ APP.ventas=r.data||[]; });
    var p4 = supabase.from('clientes').select('*').then(function(r){ APP.clientes=r.data||[]; });
    var p5 = supabase.from('ajustes_stock').select('*').then(function(r){ APP.ajustes=r.data||[]; });
    var p6 = supabase.from('objetivos').select('*').eq('id',1).maybeSingle().then(function(r){ APP.objetivos=r.data||null; });
    var tareas=[p1,p2,p3,p4,p5,p6];
    if(APP.isAdmin){
      tareas.push(supabase.from('gastos').select('*').then(function(r){ APP.gastos=r.data||[]; }));
      tareas.push(supabase.from('cheques').select('*').then(function(r){ APP.cheques=r.data||[]; }));
      tareas.push(supabase.from('inversiones').select('*').then(function(r){ APP.inversiones=r.data||[]; }));
      tareas.push(supabase.from('inversiones_historial').select('*').then(function(r){ APP.inversionesHistorial=r.data||[]; }));
      tareas.push(supabase.from('config').select('*').eq('id',1).maybeSingle().then(function(r){ APP.config=r.data||null; }));
    }
    await Promise.all(tareas);
    renderNavBadges();
    renderSection(APP.currentSection);
  }

  // ============================================================
  // DOMINIO — cálculos (idénticos a la versión anterior de la app)
  // ============================================================

  function stockDe(productoId){
    var p=APP.productos.find(function(x){ return x.id===productoId; });
    var base = p ? (Number(p.stock_inicial)||0) : 0;
    var mov=0;
    APP.ajustes.forEach(function(a){
      if(a.producto_id!==productoId) return;
      if(a.tipo==='ingreso') mov += Number(a.cantidad_kg)||0;
      else if(a.tipo==='merma') mov -= Number(a.cantidad_kg)||0;
      else if(a.tipo==='correccion') mov += Number(a.cantidad_kg)||0;
    });
    var vend=0;
    APP.ventas.forEach(function(v){
      if(v.producto_id===productoId && !v.anulada) vend += Number(v.cantidad_kg)||0;
    });
    return base+mov-vend;
  }

  function lotesDeProducto(productoId){
    return APP.ajustes.filter(function(a){ return a.tipo==='ingreso' && a.producto_id===productoId; })
      .map(function(a){
        var vendido = APP.ventas.filter(function(v){ return v.lote_id===a.id && !v.anulada; }).reduce(function(s,v){ return s+(Number(v.cantidad_kg)||0); },0);
        return { id:a.id, fecha:a.fecha, creado_en:a.creado_en, proveedor:a.proveedor||'', codigo_lote:a.codigo_lote||'', cantidad_kg:Number(a.cantidad_kg)||0, restante:(Number(a.cantidad_kg)||0)-vendido };
      })
      .filter(function(l){ return l.restante>0.001; })
      .sort(function(a,b){ return (a.creado_en||'').localeCompare(b.creado_en||''); });
  }

  function ventasPeriodo(period){
    return APP.ventas.filter(function(v){ return !v.anulada && String(v.fecha||'').indexOf(period)===0; });
  }
  function gastosPeriodo(period){
    return APP.gastos.filter(function(g){ return String(g.fecha||'').indexOf(period)===0; });
  }

  function computeLiquidacion(period){
    var ventas=ventasPeriodo(period);
    var totalVentas=ventas.reduce(function(s,v){ return s+(Number(v.total)||0); },0);
    var totalCMV=ventas.reduce(function(s,v){ return s+((Number(v.cantidad_kg)||0)*(Number(v.costo_unitario)||0)); },0);
    var margenBruto=totalVentas-totalCMV;
    var gastos=gastosPeriodo(period);
    var totalGastos=gastos.reduce(function(s,g){ return s+(Number(g.monto)||0); },0);
    var cfg=APP.config||{empleados:[],socios:[],pct_reserva_operativa:0,pct_reserva_legal:0};
    var empleados=(cfg.empleados||[]).filter(function(e){ return e && e.nombre; }).map(function(e){
      return {nombre:e.nombre, monto:Number(e.sueldo_fijo)||0};
    });
    var totalSueldosEmpleados=empleados.reduce(function(s,e){ return s+e.monto; },0);
    var socios=(cfg.socios||[]).filter(function(s){ return s && s.nombre; }).map(function(s){
      return {nombre:s.nombre, pct_sueldo:Number(s.pct_sueldo)||0, pct_dividendo:Number(s.pct_dividendo)||0};
    });
    var sueldosSocios=socios.map(function(s){ return {nombre:s.nombre, monto: totalVentas*s.pct_sueldo/100}; });
    var totalSueldosSocios=sueldosSocios.reduce(function(s,x){ return s+x.monto; },0);
    var utilidadOperativa=margenBruto-totalGastos-totalSueldosEmpleados-totalSueldosSocios;
    var base=Math.max(utilidadOperativa,0);
    var reservaOperativa=base*(Number(cfg.pct_reserva_operativa)||0)/100;
    var reservaLegal=base*(Number(cfg.pct_reserva_legal)||0)/100;
    var utilidadLiquida=base-reservaOperativa-reservaLegal;
    var dividendos=socios.map(function(s){ return {nombre:s.nombre, monto: utilidadLiquida*s.pct_dividendo/100}; });
    return {
      period:period, totalVentas:totalVentas, totalCMV:totalCMV, margenBruto:margenBruto,
      totalGastos:totalGastos, empleados:empleados, totalSueldosEmpleados:totalSueldosEmpleados,
      sueldosSocios:sueldosSocios, totalSueldosSocios:totalSueldosSocios,
      utilidadOperativa:utilidadOperativa, reservaOperativa:reservaOperativa, reservaLegal:reservaLegal,
      utilidadLiquida:utilidadLiquida, dividendos:dividendos, cantidadVentas:ventas.length
    };
  }

  // ============================================================
  // NAV
  // ============================================================

  var NAV_ICON_PATHS = {
    panel:'<rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect>',
    ventas:'<circle cx="9" cy="20" r="1.3"></circle><circle cx="17" cy="20" r="1.3"></circle><path d="M2.5 3h2.4l2.2 11.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L20.5 7H6"></path>',
    stock:'<path d="M12 3 3 7.5 12 12l9-4.5L12 3Z"></path><path d="M3 7.5V16.5L12 21l9-4.5V7.5"></path><path d="M12 12V21"></path>',
    clientes:'<circle cx="8.5" cy="8" r="3"></circle><circle cx="16" cy="9" r="2.3"></circle><path d="M2.5 19c0-3 2.7-5 6-5s6 2 6 5"></path><path d="M14.7 14.3c2.5.4 4.3 2.1 4.3 4.7"></path>',
    estadisticas:'<path d="M3 17l6-6 4 4 8-9"></path><path d="M15 6h6v6"></path>',
    finanzas:'<path d="M4 20V10"></path><path d="M11 20V4"></path><path d="M18 20v-7"></path><path d="M3 20h18"></path>',
    bancos:'<path d="M3 10 12 4l9 6"></path><path d="M5 10v9M9.5 10v9M14.5 10v9M19 10v9"></path><path d="M3 19h18"></path>',
    config:'<circle cx="12" cy="12" r="3"></circle><path d="M19.4 13.4a7.4 7.4 0 0 0 0-2.8l1.9-1.4-2-3.4-2.2.8a7.6 7.6 0 0 0-2.4-1.4L14.3 3h-4l-.4 2.2a7.6 7.6 0 0 0-2.4 1.4l-2.2-.8-2 3.4L5.2 10.6a7.4 7.4 0 0 0 0 2.8l-1.9 1.4 2 3.4 2.2-.8a7.6 7.6 0 0 0 2.4 1.4l.4 2.2h4l.4-2.2a7.6 7.6 0 0 0 2.4-1.4l2.2.8 2-3.4-1.9-1.4Z"></path>'
  };
  function navIcon(id){
    return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(NAV_ICON_PATHS[id]||'')+'</svg>';
  }
  function buildNav(){
    var items = NAV_ITEMS.concat(APP.isAdmin ? NAV_ADMIN : []);
    $('#nav').innerHTML = items.map(function(it){
      return '<button type="button" data-section="'+it.id+'" onclick="ElResero.showSection(\''+it.id+'\')">'+
        '<span class="nav-main"><span class="nav-ico">'+navIcon(it.id)+'</span><span>'+it.label+'</span></span>'+
        '<span class="nav-badge" data-badge="'+it.id+'" hidden></span></button>';
    }).join('');
  }
  function renderNavBadges(){
    var criticos = APP.productos.filter(function(p){ return stockDe(p.id) <= (Number(p.punto_reposicion)||0); }).length;
    var b = $('[data-badge="stock"]');
    if(b){ if(criticos>0){ b.hidden=false; b.textContent=criticos; } else { b.hidden=true; } }
    if(APP.isAdmin){
      var pendientes = APP.profiles.filter(function(p){ return !p.activo; }).length;
      var cb = $('[data-badge="config"]');
      if(cb){ if(pendientes>0){ cb.hidden=false; cb.textContent=pendientes; } else { cb.hidden=true; } }
    }
  }
  function showSection(id){
    APP.currentSection=id;
    $all('.section').forEach(function(s){ s.hidden = (s.id !== 'sec-'+id); });
    $all('#nav button').forEach(function(b){ b.classList.toggle('active', b.dataset.section===id); });
    $('#pageTitle').textContent = SECTION_LABELS[id] || 'Panel';
    renderSection(id);
  }
  function renderSection(id){
    if(!APP.ready) return;
    if(id==='panel') renderPanel();
    else if(id==='ventas') renderVentas();
    else if(id==='stock') renderStock();
    else if(id==='clientes') renderClientes();
    else if(id==='estadisticas') renderEstadisticas();
    else if(id==='finanzas' && APP.isAdmin) renderFinanzas();
    else if(id==='bancos' && APP.isAdmin) renderBancos();
    else if(id==='config' && APP.isAdmin) renderConfig();
    renderNavBadges();
  }

  function renderRoleBadge(){
    var el=$('#roleBadge');
    el.innerHTML = APP.isAdmin
      ? '<strong>Vista completa</strong>Ventas, stock, clientes y finanzas.'
      : '<strong>Vista operativa</strong>Ventas y stock. Las finanzas no están disponibles con tu acceso.';
  }
  function renderCurrentUserBadge(){
    if(!APP.profile) return;
    var html = '<strong>'+esc(APP.profile.nombre)+' · '+(APP.isAdmin?'Admin':'Empleado')+'</strong><a onclick="ElResero.cerrarSesion()">Cerrar sesión</a>';
    var el1=$('#currentUserBadge'); if(el1) el1.innerHTML = html;
    var el2=$('#topbarUserBadge'); if(el2) el2.innerHTML = html;
  }

  // ============================================================
  // PANEL
  // ============================================================

  function renderPanel(){
    var period=APP.panelPeriod;
    var liq=computeLiquidacion(period);
    var criticos=APP.productos.filter(function(p){ return stockDe(p.id) <= (Number(p.punto_reposicion)||0); });

    var kpis =
      '<div class="grid kpis">'+
        statTile('Ventas · '+periodLabel(period), fmtMoney(liq.totalVentas), liq.cantidadVentas+' ventas registradas', 'accent')+
        (APP.isAdmin ? statTile('Margen bruto', fmtMoney(liq.margenBruto), 'Ventas menos costo de mercadería', liq.margenBruto>=0?'ok':'warn') : '')+
        (APP.isAdmin ? statTile('Utilidad líquida', fmtMoney(liq.utilidadLiquida), 'Después de reservas', liq.utilidadLiquida>=0?'ok':'warn') : '')+
        statTile('Alertas de stock', String(criticos.length), criticos.length? 'productos en punto de reposición' : 'todo en orden', criticos.length?'warn':'ok')+
      '</div>';

    var sparkline = renderSparkline();

    var liqBlock='';
    if(APP.isAdmin){
      liqBlock =
        '<div class="section-title">Liquidación del período<span></span></div>'+
        '<div class="card">'+
          (liq.utilidadOperativa<0 ? '<div class="banner banner-warn" style="margin-bottom:14px;">Este período da pérdida operativa: los sueldos y gastos superan el margen bruto.</div>' : '')+
          '<ul class="liq-list">'+
            liLine('Ventas', liq.totalVentas)+
            liLine('Costo de mercadería (CMV)', -liq.totalCMV)+
            liLineStrong('Margen bruto', liq.margenBruto)+
            liLine('Gastos del período', -liq.totalGastos)+
            liq.empleados.map(function(e){ return liLineSub('Sueldo · '+esc(e.nombre), -e.monto); }).join('')+
            liq.sueldosSocios.map(function(s){ return liLineSub('Sueldo socio · '+esc(s.nombre), -s.monto); }).join('')+
            liLineStrong('Utilidad operativa', liq.utilidadOperativa)+
            liLine('Reserva operativa', -liq.reservaOperativa)+
            liLine('Reserva legal', -liq.reservaLegal)+
            liLineStrong('Utilidad líquida', liq.utilidadLiquida)+
            liq.dividendos.map(function(d){ return liLineSub('Dividendo · '+esc(d.nombre), d.monto); }).join('')+
          '</ul>'+
        '</div>';
    }

    var stockBlock =
      '<div class="section-title">Stock en punto de reposición<span></span></div>'+
      '<div class="table-wrap"><table><thead><tr><th>Producto</th><th class="num">Disponible</th><th class="num">Punto de reposición</th><th>Estado</th></tr></thead><tbody>'+
        (criticos.length ? criticos.map(function(p){
          var s=stockDe(p.id);
          return '<tr><td>'+esc(p.nombre)+'</td><td class="num">'+fmtKg(s)+'</td><td class="num">'+fmtKg(p.punto_reposicion)+'</td><td>'+badgeEstadoStock(s,p.punto_reposicion)+'</td></tr>';
        }).join('') : '<tr class="empty-row"><td colspan="4">No hay productos por debajo del punto de reposición.</td></tr>')+
      '</tbody></table></div>';

    var objetivoBlock = renderObjetivoProgreso(period, liq.totalVentas);
    var objetivoSection = objetivoBlock
      ? '<div class="section-title">Objetivo de ventas · '+periodLabel(period)+'<span></span></div><div class="card">'+objetivoBlock+'</div>'
      : '';

    $('#sec-panel').innerHTML =
      periodPicker('panelPeriod', period)+
      kpis+
      objetivoSection+
      '<div class="section-title">Ventas · últimos 7 días<span></span></div>'+
      '<div class="card">'+sparkline+'</div>'+
      liqBlock+
      stockBlock;

    $('#panelPeriod-input').onchange = function(){ APP.panelPeriod=this.value; renderPanel(); };
  }

  function renderObjetivoProgreso(period, totalVentas){
    var meta = (APP.objetivos && Number(APP.objetivos.meta_mensual)) || 0;
    if(!meta){
      return APP.isAdmin
        ? '<div class="hint" style="color:var(--ink-muted); font-size:13px;">Todavía no cargaste una meta de ventas mensual — la podés fijar en Configuración.</div>'
        : '';
    }
    var pct = Math.min(100, Math.round((totalVentas/meta)*100));
    var falta = Math.max(0, meta-totalVentas);
    var parts=period.split('-'); var anio=parseInt(parts[0],10), mes=parseInt(parts[1],10);
    var diasEnMes=new Date(anio, mes, 0).getDate();
    var esMesActual = (period===currentPeriod());
    var diaHoy = esMesActual ? new Date().getDate() : diasEnMes;
    var diasRestantes = Math.max(0, diasEnMes-diaHoy);
    var nota='';
    if(totalVentas>=meta){
      nota = totalVentas>meta ? 'Meta cumplida — superada por '+fmtMoney(totalVentas-meta)+'.' : 'Meta cumplida justo.';
    } else if(esMesActual && diasRestantes>0){
      nota = 'Necesitás '+fmtMoney(falta/diasRestantes)+' por día en lo que queda del mes para llegar.';
    } else if(esMesActual && diasRestantes===0){
      nota = 'Se termina el mes sin llegar a la meta.';
    } else if(!esMesActual){
      nota = 'No se llegó a la meta ese mes.';
    }
    return '<div>'+
      '<div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:6px;"><span>'+pct+'% de la meta</span><span class="mono" style="font-weight:600;">'+fmtMoney(totalVentas)+' / '+fmtMoney(meta)+'</span></div>'+
      '<div style="background:var(--surface-2); border-radius:6px; height:12px;"><div style="width:'+Math.max(2,pct)+'%; background:linear-gradient(90deg, var(--accent-2), var(--accent)); height:100%; border-radius:6px;"></div></div>'+
      (nota ? '<div class="hint" style="color:var(--ink-muted); font-size:12px; margin-top:6px;">'+esc(nota)+'</div>' : '')+
    '</div>';
  }

  function renderSparkline(){
    var days=[]; var d=new Date();
    for(var i=6;i>=0;i--){
      var dd=new Date(d); dd.setDate(d.getDate()-i);
      var iso=dd.getFullYear()+'-'+pad(dd.getMonth()+1)+'-'+pad(dd.getDate());
      var total=APP.ventas.filter(function(v){ return !v.anulada && v.fecha===iso; }).reduce(function(s,v){ return s+(Number(v.total)||0); },0);
      days.push({iso:iso, label:['D','L','M','M','J','V','S'][dd.getDay()], total:total});
    }
    var max=Math.max.apply(null, days.map(function(x){ return x.total; }).concat([1]));
    return '<div class="bars">'+days.map(function(x){
      var h = Math.max(2, Math.round((x.total/max)*72));
      return '<div class="bar-col"><div class="bar" style="height:'+h+'px" title="'+esc(x.iso)+': '+fmtMoney(x.total)+'"></div><div class="bar-label">'+x.label+'</div></div>';
    }).join('')+'</div>';
  }

  function statTile(label, value, hint, tone){
    return '<div class="card stat-tile'+(tone?' tone-'+tone:'')+'"><div class="label">'+label+'</div><div class="value'+(tone?' '+tone:'')+'">'+value+'</div><div class="hint">'+hint+'</div></div>';
  }
  function liLine(label, amt){ return '<li><span>'+label+'</span><span class="amt">'+(amt<0?'−':'')+fmtMoney(Math.abs(amt))+'</span></li>'; }
  function liLineSub(label, amt){ return '<li class="sub"><span>'+label+'</span><span class="amt">'+(amt<0?'−':'')+fmtMoney(Math.abs(amt))+'</span></li>'; }
  function liLineStrong(label, amt){ return '<li class="total"><span>'+label+'</span><span class="amt">'+fmtMoney(amt)+'</span></li>'; }
  function badgeEstadoStock(stock, punto){
    if(stock<=0) return '<span class="badge badge-danger">Sin stock</span>';
    if(stock<=Number(punto)) return '<span class="badge badge-warn">Reposición</span>';
    return '<span class="badge badge-ok">OK</span>';
  }
  function periodPicker(id, value){
    return '<div class="form-row" style="margin-bottom:16px;"><div class="field"><label for="'+id+'-input">Período</label>'+
      '<input type="month" id="'+id+'-input" value="'+esc(value)+'"></div></div>';
  }

  // ============================================================
  // VENTAS
  // ============================================================

  function renderVentas(){
    var productosOpts = APP.productos.slice().sort(function(a,b){ return a.nombre.localeCompare(b.nombre); }).map(function(p){
      return '<option value="'+p.id+'">'+esc(p.nombre)+' — disponible '+fmtKg(stockDe(p.id))+'</option>';
    }).join('');
    var clientesDatalist = APP.clientes.map(function(c){ return '<option value="'+esc(c.nombre)+'">'; }).join('');

    var recientes = APP.ventas.slice(0,60);

    $('#sec-ventas').innerHTML =
      '<div class="card">'+
        '<form id="ventaForm">'+
          '<div class="form-row">'+
            '<div class="field grow"><label for="ventaProducto">Producto</label><select id="ventaProducto" required>'+
              '<option value="">Elegí un producto</option>'+productosOpts+'</select></div>'+
            '<div class="field"><label for="ventaCanal">Canal</label><select id="ventaCanal">'+
              '<option value="B2C">Mostrador (B2C)</option><option value="B2B">Mayorista (B2B)</option></select></div>'+
            '<div class="field"><label for="ventaCantidad">Kilos</label><input id="ventaCantidad" type="number" min="0" step="0.01" placeholder="0.00" required></div>'+
          '</div>'+
          '<div class="form-row" style="margin-top:10px;">'+
            '<div class="field grow"><label for="ventaLote">Lote de origen</label><select id="ventaLote"><option value="">Elegí un producto primero</option></select></div>'+
          '</div>'+
          '<div class="form-row" style="margin-top:10px;">'+
            '<div class="field grow"><label for="ventaCliente">Cliente</label><input id="ventaCliente" list="clientesList" placeholder="Consumidor final"><datalist id="clientesList">'+clientesDatalist+'</datalist></div>'+
            '<div class="field"><label>Total</label><div class="mono" id="ventaTotalPreview" style="padding:8px 0; font-weight:600;">$0</div></div>'+
            '<div class="field"><button type="submit" class="btn btn-primary">Registrar venta</button></div>'+
          '</div>'+
          '<div class="hint" style="color:var(--ink-muted); font-size:12px; margin-top:8px;">Queda registrada a nombre de <strong style="color:var(--ink);">'+esc(APP.profile.nombre)+'</strong>.</div>'+
          '<div class="field-error" id="ventaError" hidden></div>'+
        '</form>'+
      '</div>'+
      '<div class="section-title">Ventas recientes<span></span></div>'+
      '<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Producto</th><th>Canal</th><th>Cliente</th><th class="num">Kg</th><th class="num">Total</th><th>Origen (lote)</th><th>Registró</th><th>Estado</th><th></th></tr></thead><tbody>'+
        (recientes.length ? recientes.map(rowVenta).join('') : '<tr class="empty-row"><td colspan="10">Todavía no hay ventas registradas.</td></tr>')+
      '</tbody></table></div>';

    function actualizarLotes(){
      var pid=$('#ventaProducto').value;
      var lotes = pid ? lotesDeProducto(pid) : [];
      var html = '<option value="">Sin especificar lote</option>' + lotes.map(function(l){
        var etiqueta = (l.codigo_lote?('Código '+l.codigo_lote):'Sin código') + (l.proveedor?(' — '+l.proveedor):' — proveedor no indicado') + ' · disponible '+fmtKg(l.restante);
        return '<option value="'+l.id+'">'+esc(etiqueta)+'</option>';
      }).join('');
      $('#ventaLote').innerHTML = pid ? html : '<option value="">Elegí un producto primero</option>';
    }
    function updatePreview(){
      var pid=$('#ventaProducto').value, canal=$('#ventaCanal').value, cant=parseFloat($('#ventaCantidad').value)||0;
      var p=APP.productos.find(function(x){ return x.id===pid; });
      var precio = p ? (canal==='B2C'?Number(p.precio_b2c):Number(p.precio_b2b))||0 : 0;
      $('#ventaTotalPreview').textContent = fmtMoney(precio*cant);
    }
    $('#ventaProducto').onchange=function(){ updatePreview(); actualizarLotes(); };
    $('#ventaCanal').onchange=updatePreview;
    $('#ventaCantidad').oninput=updatePreview;
    $('#ventaForm').onsubmit=registrarVenta;
  }

  function rowVenta(v){
    var key='venta:'+v.id;
    var estado = v.anulada ? '<span class="badge badge-danger">Anulada</span>' : '<span class="badge badge-ok">Activa</span>';
    var accion='';
    if(!v.anulada){
      accion = APP.confirming[key]
        ? '<button class="btn btn-danger btn-small" onclick="ElResero.anularVenta(\''+v.id+'\')">Confirmar</button> '+
          '<button class="btn btn-small" onclick="ElResero.cancelConfirm(\''+key+'\')">No</button>'
        : '<button class="btn btn-small" onclick="ElResero.askConfirm(\''+key+'\')">Anular</button>';
    }
    var origen = v.lote_codigo || v.lote_proveedor ? (esc(v.lote_codigo||'—')+(v.lote_proveedor?' · '+esc(v.lote_proveedor):'')) : '—';
    return '<tr><td>'+esc(v.fecha)+'</td><td>'+esc(v.producto_nombre)+'</td><td>'+esc(v.canal)+'</td><td>'+esc(v.cliente_nombre)+
      '</td><td class="num">'+fmtKg(v.cantidad_kg)+'</td><td class="num">'+fmtMoney(v.total)+'</td><td>'+origen+'</td><td>'+esc(nombrePorId(v.registrado_por))+
      '</td><td>'+estado+'</td><td>'+accion+'</td></tr>';
  }

  async function registrarVenta(e){
    e.preventDefault();
    hideFieldError('#ventaError');
    var productoId=$('#ventaProducto').value;
    var canal=$('#ventaCanal').value;
    var clienteNombre=$('#ventaCliente').value.trim() || 'Consumidor final';
    var cantidad=parseFloat($('#ventaCantidad').value);

    if(!productoId) return showFieldError('#ventaError','Elegí un producto.');
    if(!cantidad || cantidad<=0) return showFieldError('#ventaError','Ingresá una cantidad en kilos mayor a 0.');
    var producto=APP.productos.find(function(p){ return p.id===productoId; });
    if(!producto) return showFieldError('#ventaError','Ese producto ya no existe.');
    var disponible=stockDe(productoId);
    if(cantidad>disponible) return showFieldError('#ventaError','Stock insuficiente: quedan '+fmtKg(disponible)+' de '+producto.nombre+'.');

    var precio = canal==='B2C' ? (Number(producto.precio_b2c)||0) : (Number(producto.precio_b2b)||0);
    var total = precio*cantidad;
    var loteId = $('#ventaLote').value || null;
    var lote = loteId ? APP.ajustes.find(function(a){ return a.id===loteId; }) : null;
    try{
      var res = await supabase.from('ventas').insert({
        fecha:todayISO(), canal:canal, cliente_nombre:clienteNombre,
        producto_id:productoId, producto_nombre:producto.nombre,
        cantidad_kg:cantidad, precio_unitario:precio, costo_unitario:Number(producto.costo_kg)||0,
        total:total, registrado_por:APP.profile.id, anulada:false,
        lote_id:loteId, lote_proveedor:lote?(lote.proveedor||''):'', lote_codigo:lote?(lote.codigo_lote||''):''
      });
      if(res.error) throw res.error;
      toast('Venta registrada: '+fmtMoney(total), 'ok');
      await reload();
      renderVentas();
    }catch(err){ toast('No se pudo registrar la venta.', 'danger'); }
  }

  async function anularVenta(id){
    try{
      var res = await supabase.from('ventas').update({anulada:true, anulada_en:new Date().toISOString()}).eq('id', id);
      if(res.error) throw res.error;
      toast('Venta anulada, el stock se restituyó.', 'ok');
      await reload();
    }catch(e){ toast('No se pudo anular la venta.', 'danger'); }
    delete APP.confirming['venta:'+id];
    renderSection(APP.currentSection);
  }

  // ============================================================
  // STOCK
  // ============================================================

  function renderStock(){
    var editing = APP.editingProductId ? APP.productos.find(function(p){ return p.id===APP.editingProductId; }) : null;
    var margenB2CInicial = editing ? (editing.pct_ganancia_b2c!=null ? editing.pct_ganancia_b2c : calcMargenDesdePrecio(editing.costo_kg, editing.precio_b2c)) : '';
    var margenB2BInicial = editing ? (editing.pct_ganancia_b2b!=null ? editing.pct_ganancia_b2b : calcMargenDesdePrecio(editing.costo_kg, editing.precio_b2b)) : '';

    var adminForm = APP.isAdmin ? (
      '<div class="card">'+
        '<div class="section-title" style="margin-top:0;">'+(editing?'Editar producto':'Nuevo producto')+'<span></span></div>'+
        '<form id="prodForm">'+
          '<input type="hidden" id="prodId" value="'+(editing?editing.id:'')+'">'+
          '<div class="form-row">'+
            '<div class="field grow"><label for="prodNombre">Nombre</label><input id="prodNombre" value="'+esc(editing?editing.nombre:'')+'" required></div>'+
            '<div class="field"><label for="prodCategoria">Categoría</label><input id="prodCategoria" value="'+esc(editing?editing.categoria:'')+'"></div>'+
            '<div class="field"><label for="prodCosto">Costo/kg</label><input id="prodCosto" type="number" min="0" step="0.01" value="'+(editing?editing.costo_kg:'')+'"></div>'+
          '</div>'+
          '<div class="form-row" style="margin-top:10px;">'+
            '<div class="field"><label for="prodPrecioB2C">Precio mostrador</label><input id="prodPrecioB2C" type="number" min="0" step="0.01" value="'+(editing?editing.precio_b2c:'')+'"></div>'+
            '<div class="field"><label for="prodMargenB2C">Ganancia mostrador (%)</label><input id="prodMargenB2C" type="number" step="0.1" value="'+margenB2CInicial+'"></div>'+
            '<div class="field"><label for="prodPrecioB2B">Precio mayorista</label><input id="prodPrecioB2B" type="number" min="0" step="0.01" value="'+(editing?editing.precio_b2b:'')+'"></div>'+
            '<div class="field"><label for="prodMargenB2B">Ganancia mayorista (%)</label><input id="prodMargenB2B" type="number" step="0.1" value="'+margenB2BInicial+'"></div>'+
          '</div>'+
          '<div class="form-row" style="margin-top:10px;">'+
            '<div class="field"><label for="prodPunto">Punto de reposición (kg)</label><input id="prodPunto" type="number" min="0" step="0.1" value="'+(editing?editing.punto_reposicion:'')+'"></div>'+
            (editing ? '' : '<div class="field"><label for="prodStockInicial">Stock inicial (kg)</label><input id="prodStockInicial" type="number" min="0" step="0.01" value="0"></div>')+
          '</div>'+
          '<div class="hint" style="color:var(--ink-muted); font-size:12px; margin-top:8px;">Cambiá el costo o el % de ganancia y el precio se recalcula solo — o escribí el precio directamente y el % se ajusta.</div>'+
          '<div class="form-row" style="margin-top:12px;">'+
            '<button type="submit" class="btn btn-primary">'+(editing?'Guardar cambios':'Crear producto')+'</button>'+
            (editing ? '<button type="button" class="btn" onclick="ElResero.cancelarEdicionProducto()">Cancelar</button>' : '')+
          '</div>'+
          (editing ? '<div class="hint" style="color:var(--ink-muted); font-size:12px; margin-top:8px;">Para corregir el stock disponible usá un movimiento de stock (abajo), no este formulario.</div>' : '')+
        '</form>'+
      '</div>'
    ) : '';

    var rows = APP.productos.slice().sort(function(a,b){ return a.nombre.localeCompare(b.nombre); }).map(function(p){
      var s=stockDe(p.id);
      return '<tr><td>'+esc(p.nombre)+'</td><td>'+esc(p.categoria)+'</td><td class="num">'+fmtKg(s)+'</td>'+
        '<td class="num">'+fmtMoney(p.costo_kg)+'</td><td class="num">'+fmtMoney(p.precio_b2c)+'</td><td class="num">'+fmtMoney(p.precio_b2b)+'</td>'+
        '<td>'+badgeEstadoStock(s,p.punto_reposicion)+'</td>'+
        '<td>'+(APP.isAdmin?'<button class="btn btn-small" onclick="ElResero.editarProducto(\''+p.id+'\')">Editar</button>':'')+'</td></tr>';
    }).join('');

    var productosOptsAjuste = APP.productos.slice().sort(function(a,b){ return a.nombre.localeCompare(b.nombre); }).map(function(p){
      return '<option value="'+p.id+'">'+esc(p.nombre)+'</option>';
    }).join('');

    var proveedoresConocidos = Array.from(new Set(APP.ajustes.map(function(a){ return (a.proveedor||'').trim(); }).filter(Boolean))).sort();
    var proveedoresOpts = proveedoresConocidos.map(function(p){ return '<option value="'+esc(p)+'">'; }).join('');

    var filtro = (APP.ajusteFiltro||'').trim().toLowerCase();
    var movimientosOrdenados = APP.ajustes.slice().sort(function(a,b){ return (b.creado_en||'').localeCompare(a.creado_en||''); });
    var movimientosFiltrados = filtro ? movimientosOrdenados.filter(function(a){
      return nombreProducto(a.producto_id).toLowerCase().indexOf(filtro)>=0 ||
        (a.proveedor||'').toLowerCase().indexOf(filtro)>=0 ||
        (a.codigo_lote||'').toLowerCase().indexOf(filtro)>=0;
    }) : movimientosOrdenados;
    var movimientos = movimientosFiltrados.slice(0, filtro ? 100 : 20);

    var trazaQuery = (APP.trazaFiltro||'').trim().toLowerCase();
    var lotesTraza = trazaQuery ? APP.ajustes.filter(function(a){
      return a.tipo==='ingreso' && (
        (a.codigo_lote||'').toLowerCase().indexOf(trazaQuery)>=0 ||
        (a.proveedor||'').toLowerCase().indexOf(trazaQuery)>=0 ||
        nombreProducto(a.producto_id).toLowerCase().indexOf(trazaQuery)>=0
      );
    }).sort(function(a,b){ return (b.creado_en||'').localeCompare(a.creado_en||''); }).slice(0,25) : [];
    var trazaHtml = !trazaQuery
      ? '<div class="card"><div class="hint" style="color:var(--ink-muted); font-size:13px;">Buscá un código de lote o un proveedor para ver a qué ventas llegó ese ingreso — útil ante un reclamo.</div></div>'
      : (lotesTraza.length ? lotesTraza.map(renderLoteTraza).join('') : '<div class="card"><div class="hint" style="color:var(--ink-muted); font-size:13px;">Ningún lote coincide con esa búsqueda.</div></div>');

    $('#sec-stock').innerHTML =
      adminForm+
      '<div class="section-title" style="margin-top:'+(APP.isAdmin?'26px':'0')+';">Inventario<span></span></div>'+
      '<div class="table-wrap"><table><thead><tr><th>Producto</th><th>Categoría</th><th class="num">Disponible</th><th class="num">Costo/kg</th><th class="num">Precio mostrador</th><th class="num">Precio mayorista</th><th>Estado</th><th></th></tr></thead><tbody>'+
        (rows || '<tr class="empty-row"><td colspan="8">Todavía no hay productos cargados.</td></tr>')+
      '</tbody></table></div>'+
      '<div class="section-title">Registrar ingreso o merma<span></span></div>'+
      '<div class="card">'+
        '<form id="ajusteForm">'+
          '<div class="form-row">'+
            '<div class="field grow"><label for="ajusteProducto">Producto</label><select id="ajusteProducto" required><option value="">Elegí un producto</option>'+productosOptsAjuste+'</select></div>'+
            '<div class="field"><label for="ajusteTipo">Tipo</label><select id="ajusteTipo"><option value="ingreso">Ingreso de mercadería</option><option value="merma">Merma / descarte</option><option value="correccion">Corrección de inventario</option></select></div>'+
            '<div class="field"><label for="ajusteCantidad">Kilos</label><input id="ajusteCantidad" type="number" step="0.01" placeholder="0.00" required></div>'+
          '</div>'+
          '<div class="form-row" id="ajusteProveedorRow" style="margin-top:10px;">'+
            '<div class="field grow"><label for="ajusteProveedor">Proveedor</label><input id="ajusteProveedor" list="proveedoresList" placeholder="Ej: Frigorífico Rioplatense"><datalist id="proveedoresList">'+proveedoresOpts+'</datalist></div>'+
            '<div class="field grow"><label for="ajusteCodigo">Código de lote / etiqueta</label><input id="ajusteCodigo" placeholder="Código impreso en la etiqueta del proveedor"></div>'+
          '</div>'+
          '<div class="form-row" style="margin-top:10px;">'+
            '<div class="field grow"><label for="ajusteMotivo">Motivo</label><input id="ajusteMotivo" placeholder="Ej: compra a frigorífico, conteo físico"></div>'+
            '<div class="field"><button type="submit" class="btn btn-primary">Registrar movimiento</button></div>'+
          '</div>'+
          '<div class="hint" style="color:var(--ink-muted); font-size:12px; margin-top:8px;">Queda registrado a nombre de <strong style="color:var(--ink);">'+esc(APP.profile.nombre)+'</strong>.</div>'+
        '</form>'+
      '</div>'+
      '<div class="section-title">Últimos movimientos<span></span></div>'+
      '<div class="form-row" style="margin-bottom:10px;"><div class="field grow"><label for="ajusteFiltro">Buscar por proveedor, código o producto</label><input id="ajusteFiltro" placeholder="Ej: Rioplatense, L-4821, Bife…" value="'+esc(APP.ajusteFiltro||'')+'"></div></div>'+
      '<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th class="num">Kg</th><th>Proveedor</th><th>Código</th><th>Motivo</th><th>Registró</th></tr></thead><tbody>'+
        (movimientos.length ? movimientos.map(function(a){
          return '<tr><td>'+esc(a.fecha)+'</td><td>'+esc(nombreProducto(a.producto_id))+'</td><td>'+esc(a.tipo)+'</td><td class="num">'+fmtKg(a.cantidad_kg)+'</td>'+
            '<td>'+esc(a.proveedor||'—')+'</td><td class="mono">'+esc(a.codigo_lote||'—')+'</td><td>'+esc(a.nota||'—')+'</td><td>'+esc(nombrePorId(a.registrado_por))+'</td></tr>';
        }).join('') : '<tr class="empty-row"><td colspan="8">'+(filtro?'Ningún movimiento coincide con esa búsqueda.':'Sin movimientos registrados.')+'</td></tr>')+
      '</tbody></table></div>'+
      '<div class="section-title">Trazabilidad de lotes<span></span></div>'+
      '<div class="form-row" style="margin-bottom:10px;"><div class="field grow"><label for="trazaFiltro">Buscar código de lote o proveedor</label><input id="trazaFiltro" placeholder="Ej: L-4821 o Frigorífico Rioplatense" value="'+esc(APP.trazaFiltro||'')+'"></div></div>'+
      trazaHtml;

    if(APP.isAdmin){ $('#prodForm').onsubmit=guardarProducto; bindMargenSync(); }
    $('#ajusteForm').onsubmit=registrarAjuste;
    $('#ajusteFiltro').oninput=function(){ APP.ajusteFiltro=this.value; renderStock(); var f=$('#ajusteFiltro'); f.focus(); f.selectionStart=f.selectionEnd=f.value.length; };
    $('#trazaFiltro').oninput=function(){ APP.trazaFiltro=this.value; renderStock(); var f=$('#trazaFiltro'); f.focus(); f.selectionStart=f.selectionEnd=f.value.length; };
    toggleAjusteProveedorRow();
    $('#ajusteTipo').onchange=toggleAjusteProveedorRow;
  }

  function renderLoteTraza(a){
    var vendidoTotal = APP.ventas.filter(function(v){ return v.lote_id===a.id && !v.anulada; }).reduce(function(s,v){ return s+(Number(v.cantidad_kg)||0); },0);
    var restante = (Number(a.cantidad_kg)||0) - vendidoTotal;
    var ventasDelLote = APP.ventas.filter(function(v){ return v.lote_id===a.id; }).sort(function(x,y){ return (y.ts||'').localeCompare(x.ts||''); });
    var filasVentas = ventasDelLote.length ? ventasDelLote.map(function(v){
      return '<tr><td>'+esc(v.fecha)+'</td><td>'+esc(v.cliente_nombre)+'</td><td>'+esc(v.canal)+'</td><td class="num">'+fmtKg(v.cantidad_kg)+'</td><td>'+esc(nombrePorId(v.registrado_por))+'</td><td>'+
        (v.anulada?'<span class="badge badge-danger">Anulada</span>':'<span class="badge badge-ok">Activa</span>')+'</td></tr>';
    }).join('') : '<tr class="empty-row"><td colspan="6">Todavía no se vendió nada de este lote.</td></tr>';
    return '<div class="card" style="margin-bottom:12px;">'+
      '<div style="display:flex; flex-wrap:wrap; justify-content:space-between; gap:10px; margin-bottom:10px;">'+
        '<div><strong>'+esc(nombreProducto(a.producto_id))+'</strong><div class="hint" style="color:var(--ink-muted); font-size:12.5px; margin-top:2px;">Ingresó '+esc(a.fecha)+' · '+
          (a.codigo_lote?('Código '+esc(a.codigo_lote)):'Sin código')+(a.proveedor?(' · '+esc(a.proveedor)):' · proveedor no indicado')+'</div></div>'+
        '<div style="text-align:right;"><div class="mono" style="font-weight:600;">'+fmtKg(a.cantidad_kg)+' recibidos</div>'+
          '<div class="hint" style="color:var(--ink-muted); font-size:12.5px;">'+fmtKg(Math.max(restante,0))+' sin vender</div></div>'+
      '</div>'+
      '<div class="table-wrap"><table><thead><tr><th>Fecha venta</th><th>Cliente</th><th>Canal</th><th class="num">Kg</th><th>Registró</th><th>Estado</th></tr></thead><tbody>'+filasVentas+'</tbody></table></div>'+
    '</div>';
  }

  function toggleAjusteProveedorRow(){
    var tipoEl=$('#ajusteTipo'), row=$('#ajusteProveedorRow');
    if(!tipoEl || !row) return;
    row.hidden = (tipoEl.value !== 'ingreso');
  }

  function editarProducto(id){ APP.editingProductId=id; renderStock(); window.scrollTo({top:0, behavior:'smooth'}); }
  function cancelarEdicionProducto(){ APP.editingProductId=null; renderStock(); }

  function calcPrecioDesdeMargen(costo, margen){
    costo=Number(costo)||0; margen=Number(margen)||0;
    return Math.round(costo*(1+margen/100));
  }
  function calcMargenDesdePrecio(costo, precio){
    costo=Number(costo)||0; precio=Number(precio)||0;
    if(!costo) return 0;
    return Math.round(((precio-costo)/costo)*10000)/100;
  }
  function bindMargenSync(){
    var costoEl=$('#prodCosto'), pB2C=$('#prodPrecioB2C'), mB2C=$('#prodMargenB2C'), pB2B=$('#prodPrecioB2B'), mB2B=$('#prodMargenB2B');
    if(!costoEl) return;
    costoEl.oninput=function(){
      pB2C.value = calcPrecioDesdeMargen(costoEl.value, mB2C.value);
      pB2B.value = calcPrecioDesdeMargen(costoEl.value, mB2B.value);
    };
    mB2C.oninput=function(){ pB2C.value = calcPrecioDesdeMargen(costoEl.value, this.value); };
    mB2B.oninput=function(){ pB2B.value = calcPrecioDesdeMargen(costoEl.value, this.value); };
    pB2C.oninput=function(){ mB2C.value = calcMargenDesdePrecio(costoEl.value, this.value); };
    pB2B.oninput=function(){ mB2B.value = calcMargenDesdePrecio(costoEl.value, this.value); };
  }

  async function guardarProducto(e){
    e.preventDefault();
    var id=$('#prodId').value;
    var data={
      nombre:$('#prodNombre').value.trim(),
      categoria:$('#prodCategoria').value.trim()||'General',
      costo_kg:parseFloat($('#prodCosto').value)||0,
      precio_b2c:parseFloat($('#prodPrecioB2C').value)||0,
      precio_b2b:parseFloat($('#prodPrecioB2B').value)||0,
      pct_ganancia_b2c:parseFloat($('#prodMargenB2C').value)||0,
      pct_ganancia_b2b:parseFloat($('#prodMargenB2B').value)||0,
      punto_reposicion:parseFloat($('#prodPunto').value)||0
    };
    if(!data.nombre) return toast('Ingresá un nombre de producto.', 'danger');
    try{
      var res;
      if(id){ res = await supabase.from('productos').update(data).eq('id', id); }
      else{ data.stock_inicial=parseFloat($('#prodStockInicial').value)||0; res = await supabase.from('productos').insert(data); }
      if(res.error) throw res.error;
      toast(id?'Producto actualizado.':'Producto creado.', 'ok');
      await reload();
      cancelarEdicionProducto();
    }catch(err){ toast('No se pudo guardar el producto.', 'danger'); }
  }

  async function registrarAjuste(e){
    e.preventDefault();
    var productoId=$('#ajusteProducto').value;
    var tipo=$('#ajusteTipo').value;
    var cantidad=parseFloat($('#ajusteCantidad').value);
    var proveedor = tipo==='ingreso' ? $('#ajusteProveedor').value.trim() : '';
    var codigoLote = tipo==='ingreso' ? $('#ajusteCodigo').value.trim() : '';
    var motivo=$('#ajusteMotivo').value.trim();
    if(!productoId) return toast('Elegí un producto.', 'danger');
    if(!cantidad || (tipo!=='correccion' && cantidad<=0)) return toast('Ingresá una cantidad válida en kilos.', 'danger');
    try{
      var res = await supabase.from('ajustes_stock').insert({
        producto_id:productoId, tipo:tipo, cantidad_kg:cantidad,
        proveedor:proveedor, codigo_lote:codigoLote, nota:motivo,
        fecha:todayISO(), registrado_por:APP.profile.id
      });
      if(res.error) throw res.error;
      toast(tipo==='ingreso' && codigoLote ? 'Ingreso registrado con código '+codigoLote+'.' : 'Movimiento de stock registrado.', 'ok');
      await reload();
      renderStock();
    }catch(err){ toast('No se pudo registrar el movimiento.', 'danger'); }
  }

  // ============================================================
  // CLIENTES
  // ============================================================

  function renderClientes(){
    var rows = APP.clientes.slice().sort(function(a,b){ return a.nombre.localeCompare(b.nombre); }).map(function(c){
      var compras = APP.ventas.filter(function(v){ return !v.anulada && v.cliente_nombre && v.cliente_nombre.toLowerCase()===c.nombre.toLowerCase(); });
      var total = compras.reduce(function(s,v){ return s+(Number(v.total)||0); },0);
      return '<tr><td>'+esc(c.nombre)+'</td><td>'+esc(c.tipo)+'</td><td>'+esc(c.telefono||'—')+'</td>'+
        '<td class="num">'+compras.length+'</td><td class="num">'+fmtMoney(total)+'</td><td>'+esc(c.notas||'—')+'</td></tr>';
    }).join('');

    $('#sec-clientes').innerHTML =
      '<div class="card">'+
        '<form id="clienteForm">'+
          '<div class="form-row">'+
            '<div class="field grow"><label for="clienteNombre">Nombre</label><input id="clienteNombre" required></div>'+
            '<div class="field"><label for="clienteTipo">Tipo</label><select id="clienteTipo"><option value="B2C">Consumidor final</option><option value="B2B">Mayorista / restaurante</option></select></div>'+
            '<div class="field grow"><label for="clienteContacto">Contacto</label><input id="clienteContacto" placeholder="Teléfono o email"></div>'+
          '</div>'+
          '<div class="form-row" style="margin-top:10px;">'+
            '<div class="field grow"><label for="clienteNotas">Notas</label><input id="clienteNotas" placeholder="Preferencias, condiciones de pago, etc."></div>'+
            '<div class="field"><button type="submit" class="btn btn-primary">Agregar cliente</button></div>'+
          '</div>'+
        '</form>'+
      '</div>'+
      '<div class="section-title">Clientes<span></span></div>'+
      '<div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Tipo</th><th>Contacto</th><th class="num">Compras</th><th class="num">Total comprado</th><th>Notas</th></tr></thead><tbody>'+
        (rows || '<tr class="empty-row"><td colspan="6">Todavía no hay clientes cargados.</td></tr>')+
      '</tbody></table></div>';

    $('#clienteForm').onsubmit=agregarCliente;
  }

  async function agregarCliente(e){
    e.preventDefault();
    var nombre=$('#clienteNombre').value.trim();
    if(!nombre) return toast('Ingresá un nombre.', 'danger');
    try{
      var res = await supabase.from('clientes').insert({
        nombre:nombre, tipo:$('#clienteTipo').value, telefono:$('#clienteContacto').value.trim(),
        notas:$('#clienteNotas').value.trim()
      });
      if(res.error) throw res.error;
      toast('Cliente agregado.', 'ok');
      await reload();
      renderClientes();
    }catch(err){ toast('No se pudo agregar el cliente.', 'danger'); }
  }

  // ============================================================
  // ESTADÍSTICAS
  // ============================================================

  function computeEstadisticas(period){
    var ventas = ventasPeriodo(period);
    var totalVentas = ventas.reduce(function(s,v){ return s+(Number(v.total)||0); },0);
    var totalKg = ventas.reduce(function(s,v){ return s+(Number(v.cantidad_kg)||0); },0);
    var cantidadVentas = ventas.length;
    var ticketPromedio = cantidadVentas ? totalVentas/cantidadVentas : 0;

    var parts=period.split('-'); var anio=parseInt(parts[0],10), mes=parseInt(parts[1],10);
    var diasEnMes=new Date(anio, mes, 0).getDate();
    var hoy=todayISO(), esMesActual=(period===currentPeriod());
    var porDia=[];
    for(var d=1; d<=diasEnMes; d++){
      var iso=anio+'-'+pad(mes)+'-'+pad(d);
      if(esMesActual && iso>hoy) break;
      var total=ventas.filter(function(v){ return v.fecha===iso; }).reduce(function(s,v){ return s+(Number(v.total)||0); },0);
      porDia.push({dia:d, iso:iso, total:total});
    }

    var porProductoMap={};
    ventas.forEach(function(v){
      var key=v.producto_nombre||'—';
      if(!porProductoMap[key]) porProductoMap[key]={nombre:key, kg:0, total:0, count:0};
      porProductoMap[key].kg += Number(v.cantidad_kg)||0;
      porProductoMap[key].total += Number(v.total)||0;
      porProductoMap[key].count += 1;
    });
    var porProducto = Object.keys(porProductoMap).map(function(k){ return porProductoMap[k]; }).sort(function(a,b){ return b.total-a.total; });

    var porClienteMap={};
    ventas.forEach(function(v){
      var key=v.cliente_nombre||'Consumidor final';
      if(!porClienteMap[key]) porClienteMap[key]={nombre:key, total:0, count:0};
      porClienteMap[key].total += Number(v.total)||0;
      porClienteMap[key].count += 1;
    });
    var porCliente = Object.keys(porClienteMap).map(function(k){ return porClienteMap[k]; }).sort(function(a,b){ return b.total-a.total; });

    return {period:period, totalVentas:totalVentas, totalKg:totalKg, cantidadVentas:cantidadVentas, ticketPromedio:ticketPromedio, porDia:porDia, porProducto:porProducto, porCliente:porCliente};
  }

  function rankedList(items, maxVal, labelFn, subFn){
    if(!items.length) return '<div class="hint" style="color:var(--ink-muted); font-size:13px;">Sin datos en este período.</div>';
    return '<div style="display:flex; flex-direction:column; gap:11px;">'+items.map(function(it, idx){
      var pct = maxVal>0 ? Math.max(2, Math.round((it.total/maxVal)*100)) : 0;
      return '<div>'+
        '<div style="display:flex; justify-content:space-between; gap:10px; font-size:13px; margin-bottom:4px;"><span>'+(idx+1)+'. '+esc(labelFn(it))+'</span><span class="mono" style="font-weight:600; flex-shrink:0;">'+fmtMoney(it.total)+'</span></div>'+
        '<div style="background:var(--surface-2); border-radius:5px; height:8px;"><div style="width:'+pct+'%; background:linear-gradient(90deg, var(--accent-2), var(--accent)); height:100%; border-radius:5px;"></div></div>'+
        '<div class="hint" style="color:var(--ink-muted); font-size:11.5px; margin-top:3px;">'+esc(subFn(it))+'</div>'+
      '</div>';
    }).join('')+'</div>';
  }

  function renderEstadisticas(){
    var period=APP.statsPeriod;
    var st=computeEstadisticas(period);
    var maxDia=Math.max.apply(null, st.porDia.map(function(d){ return d.total; }).concat([1]));
    var top8Prod=st.porProducto.slice(0,8), top8Cli=st.porCliente.slice(0,8);
    var maxProd=Math.max.apply(null, top8Prod.map(function(p){ return p.total; }).concat([1]));
    var maxCli=Math.max.apply(null, top8Cli.map(function(c){ return c.total; }).concat([1]));

    var kpis =
      '<div class="grid kpis">'+
        statTile('Ventas · '+periodLabel(period), fmtMoney(st.totalVentas), st.cantidadVentas+' venta'+(st.cantidadVentas===1?'':'s'), 'accent')+
        statTile('Kilos vendidos', fmtKg(st.totalKg), 'en el período', 'ok')+
        statTile('Ticket promedio', fmtMoney(st.ticketPromedio), 'por venta') +
        statTile('Productos distintos', String(st.porProducto.length), 'vendidos este período') +
      '</div>';

    var chartDias = !st.porDia.length ? '<div class="hint" style="color:var(--ink-muted); font-size:13px;">Sin ventas en este período.</div>' :
      '<div class="bars" style="height:120px; gap:3px;">'+st.porDia.map(function(d){
        var h=Math.max(2, Math.round((d.total/maxDia)*104));
        var mostrarLabel = (d.dia===1 || d.dia%5===0);
        return '<div class="bar-col"><div class="bar" style="height:'+h+'px" title="'+esc(d.iso)+': '+fmtMoney(d.total)+'"></div>'+
          '<div class="bar-label">'+(mostrarLabel?d.dia:'')+'</div></div>';
      }).join('')+'</div>';

    $('#sec-estadisticas').innerHTML =
      periodPicker('statsPeriod', period)+
      kpis+
      '<div class="section-title">Ventas por día<span></span></div>'+
      '<div class="card">'+chartDias+'</div>'+
      '<div class="two-col" style="margin-top:26px;">'+
        '<div><div class="section-title" style="margin-top:0;">Productos más vendidos<span></span></div>'+
          '<div class="card">'+rankedList(top8Prod, maxProd, function(p){ return p.nombre; }, function(p){ return fmtKg(p.kg)+' · '+p.count+' venta'+(p.count===1?'':'s'); })+'</div>'+
        '</div>'+
        '<div><div class="section-title" style="margin-top:0;">Mejores clientes<span></span></div>'+
          '<div class="card">'+rankedList(top8Cli, maxCli, function(c){ return c.nombre; }, function(c){ return c.count+' compra'+(c.count===1?'':'s'); })+'</div>'+
        '</div>'+
      '</div>';

    $('#statsPeriod-input').onchange=function(){ APP.statsPeriod=this.value; renderEstadisticas(); };
  }

  // ============================================================
  // FINANZAS (admin)
  // ============================================================

  function renderFinanzas(){
    var period=APP.finPeriod;
    var liq=computeLiquidacion(period);
    var gastos=gastosPeriodo(period).slice().sort(function(a,b){ return (b.fecha||'').localeCompare(a.fecha||''); });

    $('#sec-finanzas').innerHTML =
      periodPicker('finPeriod', period)+
      '<div class="two-col">'+
        '<div>'+
          '<div class="card">'+
            (liq.utilidadOperativa<0 ? '<div class="banner banner-warn">Este período da pérdida operativa.</div>' : '')+
            '<ul class="liq-list">'+
              liLine('Ventas', liq.totalVentas)+
              liLine('Costo de mercadería (CMV)', -liq.totalCMV)+
              liLineStrong('Margen bruto', liq.margenBruto)+
              liLine('Gastos', -liq.totalGastos)+
              liq.empleados.map(function(e){ return liLineSub('Sueldo · '+esc(e.nombre), -e.monto); }).join('')+
              liq.sueldosSocios.map(function(s){ return liLineSub('Sueldo socio · '+esc(s.nombre), -s.monto); }).join('')+
              liLineStrong('Utilidad operativa', liq.utilidadOperativa)+
              liLine('Reserva operativa', -liq.reservaOperativa)+
              liLine('Reserva legal', -liq.reservaLegal)+
              liLineStrong('Utilidad líquida', liq.utilidadLiquida)+
              liq.dividendos.map(function(d){ return liLineSub('Dividendo · '+esc(d.nombre), d.monto); }).join('')+
            '</ul>'+
          '</div>'+
        '</div>'+
        '<div class="card">'+
          '<div class="stat-tile"><div class="label">Gastos por categoría · '+periodLabel(period)+'</div></div>'+
          gastosPorCategoria(gastos)+
        '</div>'+
      '</div>'+
      '<div class="section-title">Registrar gasto<span></span></div>'+
      '<div class="card">'+
        '<form id="gastoForm">'+
          '<div class="form-row">'+
            '<div class="field"><label for="gastoFecha">Fecha</label><input id="gastoFecha" type="date" value="'+todayISO()+'"></div>'+
            '<div class="field grow"><label for="gastoConcepto">Concepto</label><input id="gastoConcepto" required></div>'+
            '<div class="field"><label for="gastoCategoria">Categoría</label><select id="gastoCategoria">'+
              '<option>Alquiler</option><option>Servicios (luz, agua, internet)</option><option>Logística</option><option>Packaging e insumos</option><option>Instalaciones y equipamiento</option><option>Trámites y documentación</option><option>Marketing</option><option>Mantenimiento</option><option>Impuestos</option><option>Otros</option></select></div>'+
            '<div class="field"><label for="gastoMonto">Monto</label><input id="gastoMonto" type="number" min="0" step="1" required></div>'+
            '<div class="field"><button type="submit" class="btn btn-primary">Registrar</button></div>'+
          '</div>'+
        '</form>'+
      '</div>'+
      '<div class="section-title">Gastos · '+periodLabel(period)+'<span></span></div>'+
      '<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th class="num">Monto</th><th></th></tr></thead><tbody>'+
        (gastos.length ? gastos.map(rowGasto).join('') : '<tr class="empty-row"><td colspan="5">Sin gastos registrados en este período.</td></tr>')+
      '</tbody></table></div>';

    $('#finPeriod-input').onchange=function(){ APP.finPeriod=this.value; renderFinanzas(); };
    $('#gastoForm').onsubmit=agregarGasto;
  }

  function gastosPorCategoria(gastos){
    var byCat={};
    gastos.forEach(function(g){ byCat[g.categoria||'Otros']=(byCat[g.categoria||'Otros']||0)+(Number(g.monto)||0); });
    var cats=Object.keys(byCat);
    if(!cats.length) return '<div class="hint" style="color:var(--ink-muted); font-size:13px; margin-top:8px;">Sin gastos este período.</div>';
    var max=Math.max.apply(null, cats.map(function(c){ return byCat[c]; }));
    return '<div style="display:flex; flex-direction:column; gap:8px; margin-top:10px;">'+cats.map(function(c){
      var pct=Math.round((byCat[c]/max)*100);
      return '<div><div style="display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:3px;"><span>'+esc(c)+'</span><span class="mono">'+fmtMoney(byCat[c])+'</span></div>'+
        '<div style="background:var(--surface-2); border-radius:4px; height:7px;"><div style="width:'+pct+'%; background:var(--accent); height:100%; border-radius:4px;"></div></div></div>';
    }).join('')+'</div>';
  }

  function rowGasto(g){
    var key='gasto:'+g.id;
    var accion = APP.confirming[key]
      ? '<button class="btn btn-danger btn-small" onclick="ElResero.borrarGasto(\''+g.id+'\')">Confirmar</button> <button class="btn btn-small" onclick="ElResero.cancelConfirm(\''+key+'\')">No</button>'
      : '<button class="btn btn-small" onclick="ElResero.askConfirm(\''+key+'\')">Eliminar</button>';
    return '<tr><td>'+esc(g.fecha)+'</td><td>'+esc(g.concepto)+'</td><td>'+esc(g.categoria)+'</td><td class="num">'+fmtMoney(g.monto)+'</td><td>'+accion+'</td></tr>';
  }

  async function agregarGasto(e){
    e.preventDefault();
    var data={
      fecha:$('#gastoFecha').value||todayISO(), concepto:$('#gastoConcepto').value.trim(),
      categoria:$('#gastoCategoria').value, monto:parseFloat($('#gastoMonto').value)||0,
      registrado_por:APP.profile.id
    };
    if(!data.concepto || !data.monto) return toast('Completá concepto y monto.', 'danger');
    try{
      var res = await supabase.from('gastos').insert(data);
      if(res.error) throw res.error;
      toast('Gasto registrado.', 'ok'); await reload(); renderFinanzas();
    }catch(err){ toast('No se pudo registrar el gasto.', 'danger'); }
  }
  async function borrarGasto(id){
    try{
      var res = await supabase.from('gastos').delete().eq('id', id);
      if(res.error) throw res.error;
      toast('Gasto eliminado.', 'ok'); await reload();
    }catch(e){ toast('No se pudo eliminar.', 'danger'); }
    delete APP.confirming['gasto:'+id];
    renderSection(APP.currentSection);
  }

  // ============================================================
  // BANCOS Y CHEQUES (admin)
  // ============================================================

  function renderBancos(){
    var totalSaldo=APP.inversiones.reduce(function(s,i){ return s+(Number(i.saldo)||0); },0);
    var editing = APP.editingInvId ? APP.inversiones.find(function(i){ return i.id===APP.editingInvId; }) : null;

    var cheques = APP.cheques.slice().sort(function(a,b){ return (a.fecha_pago||'').localeCompare(b.fecha_pago||''); });

    $('#sec-bancos').innerHTML =
      '<div class="grid kpis" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));">'+
        statTile('Saldo total en cuentas', fmtMoney(totalSaldo), APP.inversiones.length+' cuentas cargadas', 'accent')+
        statTile('Cheques pendientes', String(cheques.filter(function(c){ return c.estado==='Pendiente'; }).length), 'a cobrar o pagar', 'warn')+
      '</div>'+
      '<div class="section-title">Cuentas e inversiones<span></span></div>'+
      '<div class="card">'+
        '<form id="invForm">'+
          '<input type="hidden" id="invId" value="'+(editing?editing.id:'')+'">'+
          '<div class="form-row">'+
            '<div class="field grow"><label for="invBanco">Banco / entidad</label><input id="invBanco" value="'+esc(editing?editing.banco:'')+'" required></div>'+
            '<div class="field grow"><label for="invTipo">Tipo de cuenta</label><input id="invTipo" value="'+esc(editing?editing.tipo_cuenta:'')+'" placeholder="Cta cte, FCI, plazo fijo…"></div>'+
            '<div class="field"><label for="invSaldo">Saldo</label><input id="invSaldo" type="number" step="0.01" value="'+(editing?editing.saldo:'')+'"></div>'+
            '<div class="field"><label for="invTasa">Tasa (% TNA)</label><input id="invTasa" type="number" step="0.01" value="'+(editing?editing.tasa_rendimiento:'')+'"></div>'+
          '</div>'+
          '<div class="form-row" style="margin-top:10px;">'+
            '<div class="field"><label for="invVencimiento">Vencimiento</label><input id="invVencimiento" type="date" value="'+(editing&&editing.vencimiento?editing.vencimiento:'')+'"></div>'+
            '<div class="field grow"><label for="invNotas">Notas</label><input id="invNotas" value="'+esc(editing?editing.notas:'')+'"></div>'+
            '<div class="field"><button type="submit" class="btn btn-primary">'+(editing?'Guardar':'Agregar cuenta')+'</button></div>'+
            (editing?'<div class="field"><button type="button" class="btn" onclick="ElResero.cancelarEdicionInv()">Cancelar</button></div>':'')+
          '</div>'+
        '</form>'+
      '</div>'+
      '<div class="table-wrap"><table><thead><tr><th>Banco</th><th>Tipo</th><th class="num">Saldo</th><th class="num">Tasa</th><th>Vencimiento</th><th>Notas</th><th></th></tr></thead><tbody>'+
        (APP.inversiones.length ? APP.inversiones.map(rowInversion).join('') : '<tr class="empty-row"><td colspan="7">Sin cuentas cargadas.</td></tr>')+
      '</tbody></table></div>'+
      (APP.viewingHistorialInvId ? renderHistorialInv(APP.viewingHistorialInvId) : '')+
      '<div class="section-title">Cheques<span></span></div>'+
      '<div class="card">'+
        '<form id="chequeForm">'+
          '<div class="form-row">'+
            '<div class="field"><label for="chequeNum">Número</label><input id="chequeNum" required></div>'+
            '<div class="field grow"><label for="chequeContraparte">Cliente / proveedor</label><input id="chequeContraparte" required></div>'+
            '<div class="field"><label for="chequeTipo">Tipo</label><select id="chequeTipo"><option value="Recibido">Recibido (a cobrar)</option><option value="Emitido">Emitido (a pagar)</option></select></div>'+
            '<div class="field"><label for="chequeMonto">Monto</label><input id="chequeMonto" type="number" min="0" step="1" required></div>'+
          '</div>'+
          '<div class="form-row" style="margin-top:10px;">'+
            '<div class="field"><label for="chequeFechaEmision">Fecha emisión</label><input id="chequeFechaEmision" type="date" value="'+todayISO()+'"></div>'+
            '<div class="field"><label for="chequeFechaPago">Fecha de pago</label><input id="chequeFechaPago" type="date" value="'+todayISO()+'"></div>'+
            '<div class="field"><button type="submit" class="btn btn-primary">Cargar cheque</button></div>'+
          '</div>'+
        '</form>'+
      '</div>'+
      '<div class="table-wrap"><table><thead><tr><th>N°</th><th>Contraparte</th><th>Tipo</th><th class="num">Monto</th><th>Vencimiento</th><th>Estado</th><th></th></tr></thead><tbody>'+
        (cheques.length ? cheques.map(rowCheque).join('') : '<tr class="empty-row"><td colspan="7">Sin cheques cargados.</td></tr>')+
      '</tbody></table></div>';

    $('#invForm').onsubmit=guardarInversion;
    $('#chequeForm').onsubmit=agregarCheque;
  }

  function rowInversion(i){
    var key='inv:'+i.id;
    var accion = APP.confirming[key]
      ? '<button class="btn btn-danger btn-small" onclick="ElResero.borrarInversion(\''+i.id+'\')">Confirmar</button> <button class="btn btn-small" onclick="ElResero.cancelConfirm(\''+key+'\')">No</button>'
      : '<button class="btn btn-small" onclick="ElResero.editarInversion(\''+i.id+'\')">Editar</button> '+
        '<button class="btn btn-small" onclick="ElResero.toggleHistorialInv(\''+i.id+'\')">Historial</button> '+
        '<button class="btn btn-small" onclick="ElResero.askConfirm(\''+key+'\')">Eliminar</button>';
    return '<tr><td>'+esc(i.banco)+'</td><td>'+esc(i.tipo_cuenta)+'</td><td class="num">'+fmtMoney(i.saldo)+'</td><td class="num">'+(i.tasa_rendimiento?i.tasa_rendimiento+'%':'—')+'</td><td>'+esc(i.vencimiento||'—')+'</td><td>'+esc(i.notas||'—')+'</td><td>'+accion+'</td></tr>';
  }
  function editarInversion(id){ APP.editingInvId=id; renderBancos(); }
  function cancelarEdicionInv(){ APP.editingInvId=null; renderBancos(); }
  function toggleHistorialInv(id){ APP.viewingHistorialInvId = (APP.viewingHistorialInvId===id ? null : id); renderBancos(); }

  function renderHistorialInv(invId){
    var inv = APP.inversiones.find(function(i){ return i.id===invId; });
    var hist = APP.inversionesHistorial.filter(function(h){ return h.inversion_id===invId; })
      .sort(function(a,b){ return (b.fecha||'').localeCompare(a.fecha||''); });
    return '<div class="card" style="margin-bottom:16px;">'+
      '<div class="section-title" style="margin-top:0;">Historial de saldo · '+esc(inv?inv.banco:'')+'<span></span></div>'+
      '<div class="table-wrap"><table><thead><tr><th>Fecha</th><th class="num">Saldo</th></tr></thead><tbody>'+
        (hist.length ? hist.map(function(h){ return '<tr><td>'+esc(h.fecha)+'</td><td class="num">'+fmtMoney(h.saldo)+'</td></tr>'; }).join('') : '<tr class="empty-row"><td colspan="2">Sin movimientos registrados todavía.</td></tr>')+
      '</tbody></table></div>'+
    '</div>';
  }

  async function guardarInversion(e){
    e.preventDefault();
    var id=$('#invId').value;
    var data={
      banco:$('#invBanco').value.trim(), tipo_cuenta:$('#invTipo').value.trim(),
      saldo:parseFloat($('#invSaldo').value)||0, tasa_rendimiento:parseFloat($('#invTasa').value)||0,
      vencimiento:$('#invVencimiento').value||null,
      notas:$('#invNotas').value.trim()
    };
    if(!data.banco) return toast('Ingresá el banco o entidad.', 'danger');
    try{
      var previo = id ? APP.inversiones.find(function(i){ return i.id===id; }) : null;
      var invIdFinal = id;
      if(id){
        var res = await supabase.from('inversiones').update(data).eq('id', id);
        if(res.error) throw res.error;
      } else {
        var ins = await supabase.from('inversiones').insert(data).select().single();
        if(ins.error) throw ins.error;
        invIdFinal = ins.data.id;
      }
      // dejamos registro en el historial cuando el saldo es nuevo o cambió
      if(!previo || Number(previo.saldo)!==Number(data.saldo)){
        await supabase.from('inversiones_historial').insert({ inversion_id:invIdFinal, saldo:data.saldo, fecha:todayISO() });
      }
      toast('Cuenta guardada.', 'ok');
      await reload();
      cancelarEdicionInv();
    }catch(err){ toast('No se pudo guardar la cuenta.', 'danger'); }
  }
  async function borrarInversion(id){
    try{
      var res = await supabase.from('inversiones').delete().eq('id', id);
      if(res.error) throw res.error;
      toast('Cuenta eliminada.', 'ok'); await reload();
    }catch(e){ toast('No se pudo eliminar.', 'danger'); }
    delete APP.confirming['inv:'+id];
    renderSection(APP.currentSection);
  }

  function rowCheque(c){
    var estados=['Pendiente','Cobrado','Pagado','Rechazado'];
    var key='cheque:'+c.id;
    var accion = APP.confirming[key]
      ? '<button class="btn btn-danger btn-small" onclick="ElResero.borrarCheque(\''+c.id+'\')">Confirmar</button> <button class="btn btn-small" onclick="ElResero.cancelConfirm(\''+key+'\')">No</button>'
      : '<button class="btn btn-small" onclick="ElResero.askConfirm(\''+key+'\')">Eliminar</button>';
    var badgeClass = c.estado==='Pendiente' ? 'badge-warn' : (c.estado==='Rechazado' ? 'badge-danger' : 'badge-ok');
    return '<tr><td>'+esc(c.numero)+'</td><td>'+esc(c.contraparte)+'</td><td>'+esc(c.tipo)+'</td><td class="num">'+fmtMoney(c.monto)+'</td><td>'+esc(c.fecha_pago)+'</td>'+
      '<td><span class="badge '+badgeClass+'">'+esc(c.estado)+'</span> '+
      '<select style="margin-left:6px; font-size:11px;" onchange="ElResero.cambiarEstadoCheque(\''+c.id+'\', this.value)">'+
        estados.map(function(e){ return '<option'+(e===c.estado?' selected':'')+'>'+e+'</option>'; }).join('')+
      '</select></td><td>'+accion+'</td></tr>';
  }

  async function agregarCheque(e){
    e.preventDefault();
    var data={
      numero:$('#chequeNum').value.trim(), contraparte:$('#chequeContraparte').value.trim(),
      tipo:$('#chequeTipo').value, monto:parseFloat($('#chequeMonto').value)||0,
      fecha_emision:$('#chequeFechaEmision').value||todayISO(), fecha_pago:$('#chequeFechaPago').value||todayISO(),
      estado:'Pendiente'
    };
    if(!data.numero || !data.contraparte || !data.monto) return toast('Completá número, contraparte y monto.', 'danger');
    try{
      var res = await supabase.from('cheques').insert(data);
      if(res.error) throw res.error;
      toast('Cheque cargado.', 'ok'); await reload(); renderBancos();
    }catch(err){ toast('No se pudo cargar el cheque.', 'danger'); }
  }
  async function cambiarEstadoCheque(id, estado){
    try{
      var res = await supabase.from('cheques').update({estado:estado}).eq('id', id);
      if(res.error) throw res.error;
      toast('Estado actualizado.', 'ok'); await reload();
    }catch(e){ toast('No se pudo actualizar el estado.', 'danger'); }
  }
  async function borrarCheque(id){
    try{
      var res = await supabase.from('cheques').delete().eq('id', id);
      if(res.error) throw res.error;
      toast('Cheque eliminado.', 'ok'); await reload();
    }catch(e){ toast('No se pudo eliminar.', 'danger'); }
    delete APP.confirming['cheque:'+id];
    renderSection(APP.currentSection);
  }

  // ============================================================
  // CONFIGURACIÓN (admin) — incluye "Personas" (permisos reales)
  // ============================================================

  var EMP_ROWS=6, SOC_ROWS=4;
  function renderConfig(){
    var cfg=APP.config||{};
    var empleados=(cfg.empleados||[]).slice(0,EMP_ROWS);
    var socios=(cfg.socios||[]).slice(0,SOC_ROWS);
    while(empleados.length<EMP_ROWS) empleados.push({nombre:'',sueldo_fijo:''});
    while(socios.length<SOC_ROWS) socios.push({nombre:'',pct_sueldo:'',pct_dividendo:''});

    var personasOrdenadas = APP.profiles.slice().sort(function(a,b){
      if(!!a.activo!==!!b.activo) return a.activo ? 1 : -1; // pendientes primero
      return a.nombre.localeCompare(b.nombre);
    });

    $('#sec-config').innerHTML =
      '<div class="card">'+
        '<form id="configForm">'+
          '<div class="field" style="margin-bottom:16px; max-width:320px;"><label for="cfgNombreNegocio">Nombre del negocio</label><input id="cfgNombreNegocio" value="'+esc(cfg.nombre_negocio||'')+'"></div>'+
          '<div class="config-grid">'+
            '<div><h3 style="font-size:15px; margin-bottom:8px;">Empleados con sueldo fijo</h3>'+
              empleados.map(function(e,i){
                return '<div class="form-row" style="margin-bottom:8px;">'+
                  '<div class="field grow"><input id="cfgEmpNombre'+i+'" placeholder="Nombre" value="'+esc(e.nombre||'')+'"></div>'+
                  '<div class="field" style="width:140px;"><input id="cfgEmpSueldo'+i+'" type="number" step="1" placeholder="Sueldo fijo" value="'+(e.sueldo_fijo!=null?e.sueldo_fijo:'')+'"></div>'+
                '</div>';
              }).join('')+
              '<div class="hint" style="color:var(--ink-muted); font-size:12px;">Dejá el nombre vacío en las filas que no uses.</div>'+
            '</div>'+
            '<div><h3 style="font-size:15px; margin-bottom:8px;">Socios</h3>'+
              socios.map(function(s,i){
                return '<div class="form-row" style="margin-bottom:8px;">'+
                  '<div class="field grow"><input id="cfgSocNombre'+i+'" placeholder="Nombre" value="'+esc(s.nombre||'')+'"></div>'+
                  '<div class="field" style="width:110px;"><input id="cfgSocSueldo'+i+'" type="number" step="0.1" placeholder="% de ventas" value="'+(s.pct_sueldo!=null?s.pct_sueldo:'')+'"></div>'+
                  '<div class="field" style="width:110px;"><input id="cfgSocDiv'+i+'" type="number" step="0.1" placeholder="% dividendo" value="'+(s.pct_dividendo!=null?s.pct_dividendo:'')+'"></div>'+
                '</div>';
              }).join('')+
              '<div class="hint" style="color:var(--ink-muted); font-size:12px;">Sueldo = % de las ventas del período. Dividendo = % de la utilidad líquida.</div>'+
            '</div>'+
          '</div>'+
          '<div class="form-row" style="margin-top:18px;">'+
            '<div class="field" style="width:200px;"><label for="cfgReservaOp">Reserva operativa (%)</label><input id="cfgReservaOp" type="number" step="0.1" value="'+(cfg.pct_reserva_operativa!=null?cfg.pct_reserva_operativa:0)+'"></div>'+
            '<div class="field" style="width:200px;"><label for="cfgReservaLegal">Reserva legal (%)</label><input id="cfgReservaLegal" type="number" step="0.1" value="'+(cfg.pct_reserva_legal!=null?cfg.pct_reserva_legal:0)+'"></div>'+
          '</div>'+
          '<div class="form-row" style="margin-top:16px;"><button type="submit" class="btn btn-primary">Guardar configuración</button></div>'+
        '</form>'+
      '</div>'+
      '<div class="banner banner-info" style="margin-top:18px;">Estos porcentajes se aplican a las ventas y a la utilidad líquida de cada período elegido en Panel y Finanzas — no son acumulados históricos.</div>'+
      '<div class="section-title">Objetivo de ventas<span></span></div>'+
      '<div class="card">'+
        '<form id="objetivoForm">'+
          '<div class="field" style="max-width:260px; margin-bottom:8px;"><label for="cfgMetaMensual">Meta de ventas mensual ($)</label><input id="cfgMetaMensual" type="number" step="1000" min="0" value="'+(APP.objetivos&&APP.objetivos.meta_mensual!=null?APP.objetivos.meta_mensual:'')+'"></div>'+
          '<div class="hint" style="color:var(--ink-muted); font-size:12px; margin-bottom:12px; max-width:60ch;">Se aplica igual todos los meses hasta que la cambies vos. La ven todos — empleados y socios — como % de avance en Panel; nunca se muestran sueldos, margen ni dividendos ahí.</div>'+
          '<button type="submit" class="btn btn-primary">Guardar meta</button>'+
        '</form>'+
      '</div>'+
      '<div class="section-title">Copia de seguridad<span></span></div>'+
      '<div class="card">'+
        '<p style="margin:0 0 12px; color:var(--ink-muted); font-size:13px; max-width:60ch;">Descargá un archivo con todos los datos actuales (productos, ventas, clientes, stock, gastos, cheques e inversiones) por si necesitás guardarlos aparte.</p>'+
        '<button type="button" class="btn" onclick="ElResero.hacerBackupAhora()">Descargar backup ahora</button>'+
      '</div>'+
      '<div class="section-title">Personas<span></span></div>'+
      '<div class="hint" style="color:var(--ink-muted); font-size:12px; margin-bottom:8px; max-width:70ch;">Cada persona crea su propia cuenta (email y contraseña) y queda pendiente hasta que vos la activás acá. Solo vos podés activar cuentas y asignar el rol de administrador.</div>'+
      '<div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Rol</th><th>Estado</th><th></th></tr></thead><tbody>'+
        (personasOrdenadas.length ? personasOrdenadas.map(rowPersona).join('') : '<tr class="empty-row"><td colspan="4">Todavía no se registró nadie.</td></tr>')+
      '</tbody></table></div>';

    $('#configForm').onsubmit=guardarConfig;
    $('#objetivoForm').onsubmit=guardarObjetivo;
  }

  function rowPersona(p){
    var esUnoMismo = APP.profile && p.id===APP.profile.id;
    var estadoBadge = p.activo ? '<span class="badge badge-ok">Activo</span>' : '<span class="badge badge-warn">Pendiente de aprobación</span>';
    var controles;
    if(esUnoMismo){
      controles = '<span class="hint" style="color:var(--ink-muted); font-size:12px;">Vos</span>';
    } else {
      controles =
        '<select style="font-size:12px; margin-right:6px;" onchange="ElResero.cambiarRolPersona(\''+p.id+'\', this.value)">'+
          '<option value="empleado"'+(p.rol==='empleado'?' selected':'')+'>Empleado</option>'+
          '<option value="admin"'+(p.rol==='admin'?' selected':'')+'>Admin</option>'+
        '</select>'+
        '<button class="btn btn-small" onclick="ElResero.togglePersonaActivo(\''+p.id+'\')">'+(p.activo?'Desactivar':'Activar')+'</button>';
    }
    return '<tr><td>'+esc(p.nombre)+'</td><td>'+(p.rol==='admin'?'<span class="badge badge-ok">Admin</span>':'<span class="badge">Empleado</span>')+'</td><td>'+estadoBadge+'</td><td>'+controles+'</td></tr>';
  }

  async function togglePersonaActivo(id){
    var p = APP.profiles.find(function(x){ return x.id===id; });
    if(!p) return;
    try{
      var res = await supabase.from('profiles').update({activo: !p.activo}).eq('id', id);
      if(res.error) throw res.error;
      toast(p.activo ? 'Cuenta desactivada.' : 'Cuenta activada.', 'ok');
      await reload();
      renderConfig();
    }catch(err){ toast('No se pudo actualizar la cuenta.', 'danger'); }
  }
  async function cambiarRolPersona(id, rol){
    try{
      var res = await supabase.from('profiles').update({rol: rol}).eq('id', id);
      if(res.error) throw res.error;
      toast('Rol actualizado.', 'ok');
      await reload();
      renderConfig();
    }catch(err){ toast('No se pudo actualizar el rol.', 'danger'); }
  }

  async function guardarObjetivo(e){
    e.preventDefault();
    var meta = parseFloat($('#cfgMetaMensual').value)||0;
    try{
      var res = await supabase.from('objetivos').upsert({ id:1, meta_mensual: meta, actualizado_en: new Date().toISOString() });
      if(res.error) throw res.error;
      toast('Meta de ventas actualizada.', 'ok');
      await reload();
    }catch(err){ toast('No se pudo guardar la meta.', 'danger'); }
  }

  async function guardarConfig(e){
    e.preventDefault();
    var empleados=[];
    for(var i=0;i<EMP_ROWS;i++){
      var nombre=$('#cfgEmpNombre'+i).value.trim();
      if(nombre) empleados.push({nombre:nombre, sueldo_fijo:parseFloat($('#cfgEmpSueldo'+i).value)||0});
    }
    var socios=[];
    for(var j=0;j<SOC_ROWS;j++){
      var sn=$('#cfgSocNombre'+j).value.trim();
      if(sn) socios.push({nombre:sn, pct_sueldo:parseFloat($('#cfgSocSueldo'+j).value)||0, pct_dividendo:parseFloat($('#cfgSocDiv'+j).value)||0});
    }
    var data={
      id:1,
      nombre_negocio:$('#cfgNombreNegocio').value.trim()||'El Resero',
      empleados:empleados, socios:socios,
      pct_reserva_operativa:parseFloat($('#cfgReservaOp').value)||0,
      pct_reserva_legal:parseFloat($('#cfgReservaLegal').value)||0,
      actualizado_en:new Date().toISOString()
    };
    try{
      var res = await supabase.from('config').upsert(data);
      if(res.error) throw res.error;
      toast('Configuración guardada.', 'ok');
      await reload();
    }catch(err){ toast('No se pudo guardar la configuración.', 'danger'); }
  }

  function hacerBackupAhora(){
    var payload = {
      generado_en: new Date().toISOString(),
      generado_por: APP.profile ? APP.profile.nombre : '(admin)',
      negocio: (APP.config && APP.config.nombre_negocio) || 'El Resero',
      productos: APP.productos, ventas: APP.ventas, clientes: APP.clientes,
      ajustes_stock: APP.ajustes, gastos: APP.gastos, cheques: APP.cheques,
      inversiones: APP.inversiones, personas: APP.profiles, config: APP.config
    };
    try{
      var blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'backup-el-resero-'+todayISO()+'.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
      toast('Backup descargado.', 'ok');
    }catch(err){ toast('No se pudo generar el backup.', 'danger'); }
  }

  // ---------- confirm helper ----------
  function askConfirm(key){ APP.confirming[key]=true; renderSection(APP.currentSection); }
  function cancelConfirm(key){ delete APP.confirming[key]; renderSection(APP.currentSection); }

  window.ElResero = {
    showSection:showSection, askConfirm:askConfirm, cancelConfirm:cancelConfirm,
    anularVenta:anularVenta, editarProducto:editarProducto, cancelarEdicionProducto:cancelarEdicionProducto,
    borrarGasto:borrarGasto, editarInversion:editarInversion, cancelarEdicionInv:cancelarEdicionInv,
    toggleHistorialInv:toggleHistorialInv,
    borrarInversion:borrarInversion, cambiarEstadoCheque:cambiarEstadoCheque, borrarCheque:borrarCheque,
    togglePersonaActivo:togglePersonaActivo, cambiarRolPersona:cambiarRolPersona,
    hacerBackupAhora:hacerBackupAhora,
    setAuthMode:setAuthMode, cerrarSesion:cerrarSesion, reintentarAprobacion:reintentarAprobacion
  };

  initAuth();
})();
