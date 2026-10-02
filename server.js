const express=require('express');
const session=require('express-session');
const Database=require('better-sqlite3');
const bcrypt=require('bcryptjs');
const helmet=require('helmet');
const path=require('path');

const app=express();
const db=new Database(process.env.DB_PATH||'rice.db');
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS appointments(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 date TEXT NOT NULL,start_time TEXT NOT NULL,truck_type TEXT NOT NULL,
 carrier TEXT NOT NULL,order_number TEXT NOT NULL,driver_name TEXT NOT NULL,
 phone TEXT NOT NULL,carrying TEXT NOT NULL,pickup_location TEXT NOT NULL,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS slot_unique ON appointments(date,start_time);
CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY,username TEXT UNIQUE,password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT,appointment_id INTEGER,action TEXT NOT NULL,details TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
if(!db.prepare('SELECT 1 FROM admins').get()){
 const p=process.env.ADMIN_PASSWORD||'CHANGE-ME-NOW';
 db.prepare('INSERT INTO admins(username,password_hash) VALUES (?,?)').run('admin',bcrypt.hashSync(p,12));
 console.log('Initial admin created. Set ADMIN_PASSWORD before first production run.');
}
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json());app.use(express.urlencoded({extended:false}));
app.use(session({secret:process.env.SESSION_SECRET||'replace-this-session-secret',resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:8*60*60*1000}}));
app.use(express.static(path.join(__dirname,'public')));
const auth=(req,res,next)=>req.session.admin?next():res.status(401).json({error:'Unauthorized'});
const pad=n=>String(n).padStart(2,'0');
function localISO(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function parseDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return null;const [y,m,d]=s.split('-').map(Number);const x=new Date(y,m-1,d,12);return x.getFullYear()===y&&x.getMonth()===m-1&&x.getDate()===d?x:null}
function validDate(s){const x=parseDate(s);return !!x&&x.getDay()!==0&&x.getDay()!==6&&s>localISO(new Date())}
function slots(){let a=[];for(let m=7*60;m<=15*60+30;m+=30)a.push(`${pad(Math.floor(m/60))}:${pad(m%60)}`);return a}
function validBody(b){const fields=['date','start_time','truck_type','carrier','order_number','driver_name','phone','carrying','pickup_location'];if(fields.some(k=>!String(b[k]||'').trim()))return 'Complete all required fields.';if(!validDate(b.date)||!slots().includes(b.start_time))return 'Invalid appointment date/time.';return null}
function audit(id,action,details){db.prepare('INSERT INTO audit_log(appointment_id,action,details) VALUES (?,?,?)').run(id,action,JSON.stringify(details||{}))}
app.get('/api/config',(req,res)=>res.json({minAdvanceDays:1,weekends:false,slots:slots(),truckTypes:['Flatbed','Van / Box Truck','Other'],carrying:['Shingles','Accessories','Other']}));
app.get('/api/availability',(req,res)=>{if(!validDate(req.query.date))return res.json([]);const used=new Set(db.prepare('SELECT start_time FROM appointments WHERE date=?').all(req.query.date).map(x=>x.start_time));res.json(slots().filter(x=>!used.has(x)))});
app.post('/api/appointments',(req,res)=>{const b=req.body;const problem=validBody(b);if(problem)return res.status(400).json({error:problem});try{const r=db.prepare(`INSERT INTO appointments(date,start_time,truck_type,carrier,order_number,driver_name,phone,carrying,pickup_location) VALUES (@date,@start_time,@truck_type,@carrier,@order_number,@driver_name,@phone,@carrying,@pickup_location)`).run(b);audit(r.lastInsertRowid,'created',b);res.json({ok:true,id:r.lastInsertRowid})}catch(e){res.status(409).json({error:'That appointment time was just taken. Please choose another.'})}});
app.post('/api/admin/login',(req,res)=>{const a=db.prepare('SELECT * FROM admins WHERE username=?').get(req.body.username||'admin');if(a&&bcrypt.compareSync(req.body.password||'',a.password_hash)){req.session.admin=a.id;return res.json({ok:true})}res.status(401).json({error:'Incorrect username or password.'})});
app.post('/api/admin/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/admin/me',(req,res)=>res.json({loggedIn:!!req.session.admin}));
app.get('/api/admin/appointments',auth,(req,res)=>{const days=Math.max(1,Math.min(+req.query.days||1,60));const now=new Date();const end=new Date(now.getFullYear(),now.getMonth(),now.getDate()+days-1,12);res.json(db.prepare('SELECT * FROM appointments WHERE date BETWEEN ? AND ? ORDER BY date,start_time').all(localISO(now),localISO(end)))});
app.put('/api/admin/appointments/:id',auth,(req,res)=>{const b=req.body;const problem=validBody(b);if(problem)return res.status(400).json({error:problem});const old=db.prepare('SELECT * FROM appointments WHERE id=?').get(req.params.id);if(!old)return res.status(404).json({error:'Appointment not found.'});try{db.prepare(`UPDATE appointments SET date=@date,start_time=@start_time,truck_type=@truck_type,carrier=@carrier,order_number=@order_number,driver_name=@driver_name,phone=@phone,carrying=@carrying,pickup_location=@pickup_location,updated_at=CURRENT_TIMESTAMP WHERE id=@id`).run({...b,id:req.params.id});audit(req.params.id,'updated',{before:old,after:b});res.json({ok:true})}catch(e){res.status(409).json({error:'Unable to save; that slot may already be occupied.'})}});
app.delete('/api/admin/appointments/:id',auth,(req,res)=>{const old=db.prepare('SELECT * FROM appointments WHERE id=?').get(req.params.id);if(!old)return res.status(404).json({error:'Appointment not found.'});db.prepare('DELETE FROM appointments WHERE id=?').run(req.params.id);audit(req.params.id,'removed',old);res.json({ok:true})});
app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));
app.listen(process.env.PORT||3000,()=>console.log('Rice Receiving running on http://localhost:'+(process.env.PORT||3000)));
