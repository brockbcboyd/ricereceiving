const express=require('express');
const session=require('express-session');
const helmet=require('helmet');
const path=require('path');
const fs=require('fs');
const crypto=require('crypto');

const app=express();
const DATA_FILE=process.env.DATA_FILE||path.join(__dirname,'rice-data.json');
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'CHANGE-ME-NOW';
const SESSION_SECRET=process.env.SESSION_SECRET||crypto.randomBytes(32).toString('hex');
const TZ='America/Chicago';
const TRUCKS=['Flatbed','Van / Box Truck'];
const MATERIALS=['Shingles','Rolls','Boxes','Other'];
const CAPACITY_SLOTS=Array.from({length:16},(_,i)=>{const m=420+i*30;return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;}); // 7:00 through 2:30

function blankDB(){return {nextId:1,nextBlackoutId:1,appointments:[],blackouts:[],audit:[]};}
function readDB(){try{const d=JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));return {...blankDB(),...d,appointments:d.appointments||[],blackouts:d.blackouts||[],audit:d.audit||[]};}catch{return blankDB();}}
function writeDB(db){const tmp=DATA_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(db,null,2));fs.renameSync(tmp,DATA_FILE);}
if(!fs.existsSync(DATA_FILE))writeDB(blankDB());

app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json());app.use(express.urlencoded({extended:false}));
app.use(session({secret:SESSION_SECRET,resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:false,maxAge:8*60*60*1000}}));
app.use(express.static(path.join(__dirname,'public')));
const auth=(req,res,next)=>req.session.admin===true?next():res.status(401).json({error:'Unauthorized'});
const clean=v=>String(v??'').trim();
function dateParts(d){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(d||'');if(!m)return null;const x=new Date(+m[1],+m[2]-1,+m[3],12);if(x.getFullYear()!=+m[1]||x.getMonth()!=+m[2]-1||x.getDate()!=+m[3])return null;return x;}
function localToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function validBookDate(d){const x=dateParts(d);return !!x&&x.getDay()!==0&&x.getDay()!==6&&d>localToday();}
function validAdminDate(d){const x=dateParts(d);return !!x&&x.getDay()!==0&&x.getDay()!==6;}
function occupiedSlots(truck,start){const i=CAPACITY_SLOTS.indexOf(start);if(i<0)return [];if(truck==='Flatbed')return [start];if(truck==='Van / Box Truck'&&i<CAPACITY_SLOTS.length-1)return [start,CAPACITY_SLOTS[i+1]];return [];}
function blackoutSlots(db,date){const s=new Set();for(const b of db.blackouts.filter(x=>x.date===date)){if(b.all_day)CAPACITY_SLOTS.forEach(x=>s.add(x));else s.add(b.start_time);}return s;}
function usedSlots(db,date,excludeId=null){const s=blackoutSlots(db,date);for(const a of db.appointments.filter(x=>x.date===date&&x.id!==excludeId))occupiedSlots(a.truck_type,a.start_time).forEach(x=>s.add(x));return s;}
function availableStarts(db,date,truck,excludeId=null){if(!validBookDate(date)&&excludeId===null)return [];if(!TRUCKS.includes(truck))return [];const used=usedSlots(db,date,excludeId);return CAPACITY_SLOTS.filter(start=>{const need=occupiedSlots(truck,start);return need.length&&(truck!=='Van / Box Truck'||need.length===2)&&need.every(x=>!used.has(x));});}
function validate(b,admin=false){const fields=['date','start_time','truck_type','carrier','order_number','driver_name','phone','carrying','pickup_location'];for(const k of fields)if(!clean(b[k]))return 'Complete all required fields.';if(!(admin?validAdminDate(b.date):validBookDate(b.date)))return 'Invalid appointment date.';if(!TRUCKS.includes(clean(b.truck_type)))return 'Invalid truck type.';if(!CAPACITY_SLOTS.includes(clean(b.start_time))||!occupiedSlots(clean(b.truck_type),clean(b.start_time)).length)return 'Invalid appointment time.';const mats=clean(b.carrying).split(',').map(x=>x.trim()).filter(Boolean);if(!mats.length||mats.some(x=>!MATERIALS.includes(x)))return 'Invalid material selection.';return null;}
function audit(db,action,id,before,after){db.audit.unshift({at:new Date().toISOString(),action,id,before,after});db.audit=db.audit.slice(0,1000);}

app.get('/api/availability',(req,res)=>{const date=clean(req.query.date),truck=clean(req.query.truck_type);if(!validBookDate(date)||!TRUCKS.includes(truck))return res.json([]);res.json(availableStarts(readDB(),date,truck));});
app.post('/api/appointments',(req,res)=>{const b=req.body,e=validate(b);if(e)return res.status(400).json({error:e});const db=readDB();if(!availableStarts(db,clean(b.date),clean(b.truck_type)).includes(clean(b.start_time)))return res.status(409).json({error:'That appointment time is no longer available. Please choose another.'});const now=new Date().toISOString();const keys=['date','start_time','truck_type','carrier','order_number','driver_name','phone','carrying','pickup_location'];const a={id:db.nextId++,...Object.fromEntries(keys.map(k=>[k,clean(b[k])])),created_at:now,updated_at:now};db.appointments.push(a);audit(db,'create',a.id,null,a);writeDB(db);res.json({ok:true,id:a.id});});
app.post('/api/admin/login',(req,res)=>{const a=Buffer.from(clean(req.body.password).padEnd(128).slice(0,128)),b=Buffer.from(ADMIN_PASSWORD.padEnd(128).slice(0,128));if(crypto.timingSafeEqual(a,b)){req.session.admin=true;return res.json({ok:true});}res.status(401).json({error:'Incorrect password.'});});
app.post('/api/admin/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/admin/me',(req,res)=>res.json({loggedIn:req.session.admin===true}));
app.get('/api/admin/appointments',auth,(req,res)=>{const days=Math.min(Math.max(+req.query.days||1,1),60);const start=dateParts(localToday()),end=new Date(start);end.setDate(end.getDate()+days-1);const fmt=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;const db=readDB();res.json(db.appointments.filter(a=>a.date>=fmt(start)&&a.date<=fmt(end)).sort((a,b)=>(a.date+a.start_time).localeCompare(b.date+b.start_time)));});
app.put('/api/admin/appointments/:id',auth,(req,res)=>{const b=req.body,e=validate(b,true);if(e)return res.status(400).json({error:e});const db=readDB(),id=+req.params.id,i=db.appointments.findIndex(a=>a.id===id);if(i<0)return res.status(404).json({error:'Appointment not found.'});const need=occupiedSlots(clean(b.truck_type),clean(b.start_time)),used=usedSlots(db,clean(b.date),id);if(!need.length||need.some(x=>used.has(x)))return res.status(409).json({error:'Unable to save; that time overlaps another appointment or blackout.'});const before={...db.appointments[i]},keys=['date','start_time','truck_type','carrier','order_number','driver_name','phone','carrying','pickup_location'];db.appointments[i]={...before,...Object.fromEntries(keys.map(k=>[k,clean(b[k])])),updated_at:new Date().toISOString()};audit(db,'update',id,before,db.appointments[i]);writeDB(db);res.json({ok:true});});
app.delete('/api/admin/appointments/:id',auth,(req,res)=>{const db=readDB(),id=+req.params.id,i=db.appointments.findIndex(a=>a.id===id);if(i<0)return res.status(404).json({error:'Appointment not found.'});const [before]=db.appointments.splice(i,1);audit(db,'remove',id,before,null);writeDB(db);res.json({ok:true});});
app.get('/api/admin/blackouts',auth,(req,res)=>{res.json(readDB().blackouts.sort((a,b)=>(a.date+(a.start_time||'')).localeCompare(b.date+(b.start_time||''))));});
app.post('/api/admin/blackouts',auth,(req,res)=>{const date=clean(req.body.date),all_day=!!req.body.all_day,start_time=clean(req.body.start_time),reason=clean(req.body.reason);if(!validAdminDate(date))return res.status(400).json({error:'Choose a valid Monday–Friday date.'});if(!all_day&&!CAPACITY_SLOTS.includes(start_time))return res.status(400).json({error:'Choose a valid time block.'});const db=readDB();if(db.blackouts.some(b=>b.date===date&&(b.all_day||all_day||b.start_time===start_time)))return res.status(409).json({error:'That date/time is already blocked.'});const conflict=db.appointments.some(a=>a.date===date&&(all_day||occupiedSlots(a.truck_type,a.start_time).includes(start_time)));if(conflict)return res.status(409).json({error:'An appointment already occupies that date/time. Move or remove it first.'});const x={id:db.nextBlackoutId++,date,all_day,start_time:all_day?'':start_time,reason,created_at:new Date().toISOString()};db.blackouts.push(x);audit(db,'blackout-create',x.id,null,x);writeDB(db);res.json({ok:true,id:x.id});});
app.delete('/api/admin/blackouts/:id',auth,(req,res)=>{const db=readDB(),id=+req.params.id,i=db.blackouts.findIndex(x=>x.id===id);if(i<0)return res.status(404).json({error:'Blackout not found.'});const [before]=db.blackouts.splice(i,1);audit(db,'blackout-remove',id,before,null);writeDB(db);res.json({ok:true});});
app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));
app.listen(process.env.PORT||3000,()=>console.log('Rice Receiving V4 running on http://localhost:'+(process.env.PORT||3000)));
