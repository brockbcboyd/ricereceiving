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

function blankDB(){return {nextId:1,appointments:[],audit:[]};}
function readDB(){try{return JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));}catch{return blankDB();}}
function writeDB(db){const tmp=DATA_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(db,null,2));fs.renameSync(tmp,DATA_FILE);}
if(!fs.existsSync(DATA_FILE))writeDB(blankDB());

app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json());
app.use(express.urlencoded({extended:false}));
app.use(session({secret:SESSION_SECRET,resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:false,maxAge:8*60*60*1000}}));
app.use(express.static(path.join(__dirname,'public')));

const auth=(req,res,next)=>req.session.admin===true?next():res.status(401).json({error:'Unauthorized'});
const clean=v=>String(v??'').trim();
function dateParts(d){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(d||'');if(!m)return null;const x=new Date(+m[1],+m[2]-1,+m[3],12);if(x.getFullYear()!=+m[1]||x.getMonth()!=+m[2]-1||x.getDate()!=+m[3])return null;return x;}
function localToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function validDate(d){const x=dateParts(d);if(!x||x.getDay()===0||x.getDay()===6)return false;return d>localToday();}
function slots(){const a=[];for(let m=7*60;m<=15*60+30;m+=30)a.push(String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'));return a;}
function validate(b){const fields=['date','start_time','truck_type','carrier','order_number','driver_name','phone','carrying','pickup_location'];for(const k of fields)if(!clean(b[k]))return 'Complete all required fields.';if(!validDate(b.date)||!slots().includes(b.start_time))return 'Invalid appointment date/time.';return null;}
function audit(db,action,id,before,after){db.audit.unshift({at:new Date().toISOString(),action,id,before,after});db.audit=db.audit.slice(0,1000);}

app.get('/api/availability',(req,res)=>{if(!validDate(req.query.date))return res.json([]);const db=readDB();const used=new Set(db.appointments.filter(a=>a.date===req.query.date).map(a=>a.start_time));res.json(slots().filter(x=>!used.has(x)));});
app.post('/api/appointments',(req,res)=>{const b=req.body,e=validate(b);if(e)return res.status(400).json({error:e});const db=readDB();if(db.appointments.some(a=>a.date===b.date&&a.start_time===b.start_time))return res.status(409).json({error:'That appointment time was just taken. Please choose another.'});const now=new Date().toISOString();const a={id:db.nextId++,...Object.fromEntries(['date','start_time','truck_type','carrier','order_number','driver_name','phone','carrying','pickup_location'].map(k=>[k,clean(b[k])])),created_at:now,updated_at:now};db.appointments.push(a);audit(db,'create',a.id,null,a);writeDB(db);res.json({ok:true,id:a.id});});
app.post('/api/admin/login',(req,res)=>{if(crypto.timingSafeEqual(Buffer.from(clean(req.body.password).padEnd(128).slice(0,128)),Buffer.from(ADMIN_PASSWORD.padEnd(128).slice(0,128)))){req.session.admin=true;return res.json({ok:true});}res.status(401).json({error:'Incorrect password.'});});
app.post('/api/admin/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/admin/me',(req,res)=>res.json({loggedIn:req.session.admin===true}));
app.get('/api/admin/appointments',auth,(req,res)=>{const days=Math.min(Math.max(+req.query.days||1,1),60);const start=dateParts(localToday());const end=new Date(start);end.setDate(end.getDate()+days-1);const fmt=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;const db=readDB();res.json(db.appointments.filter(a=>a.date>=fmt(start)&&a.date<=fmt(end)).sort((a,b)=>(a.date+a.start_time).localeCompare(b.date+b.start_time)));});
app.put('/api/admin/appointments/:id',auth,(req,res)=>{const b=req.body,e=validate(b);if(e)return res.status(400).json({error:e});const db=readDB(),id=+req.params.id,i=db.appointments.findIndex(a=>a.id===id);if(i<0)return res.status(404).json({error:'Appointment not found.'});if(db.appointments.some(a=>a.id!==id&&a.date===b.date&&a.start_time===b.start_time))return res.status(409).json({error:'Unable to save; that slot is already occupied.'});const before={...db.appointments[i]};db.appointments[i]={...before,...Object.fromEntries(['date','start_time','truck_type','carrier','order_number','driver_name','phone','carrying','pickup_location'].map(k=>[k,clean(b[k])])),updated_at:new Date().toISOString()};audit(db,'update',id,before,db.appointments[i]);writeDB(db);res.json({ok:true});});
app.delete('/api/admin/appointments/:id',auth,(req,res)=>{const db=readDB(),id=+req.params.id,i=db.appointments.findIndex(a=>a.id===id);if(i<0)return res.status(404).json({error:'Appointment not found.'});const [before]=db.appointments.splice(i,1);audit(db,'remove',id,before,null);writeDB(db);res.json({ok:true});});
app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));
app.listen(process.env.PORT||3000,()=>{console.log('Rice Receiving V3 running on http://localhost:'+(process.env.PORT||3000));console.log('Admin login uses ADMIN_PASSWORD only.');});
