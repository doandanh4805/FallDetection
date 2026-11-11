'use strict';
const $=id=>document.getElementById(id);
let client=null,retry=null,connected=false,state=null,live=false,availability=null,baseline=null;
let lastReceive=0,pending=null,message='',history=[],activeBase='',activeUrl='';
const labels={CALIBRATING:'Đang lấy tư thế chuẩn',READY:'Đang theo dõi chuyển động',VERIFY:'Đang xác minh va đập',ALARM:'Phát hiện tình huống nghi té ngã',SENSOR_FAULT:'Không đọc được MPU6050'};
const descriptions={CALIBRATING:'Giữ cảm biến đứng yên ở tư thế đứng khoảng 2 giây.',READY:'Chưa có chuỗi va đập và đổi tư thế thỏa điều kiện cảnh báo.',VERIFY:'Đã có va đập; đang kiểm tra góc nghiêng và độ ổn định sau va đập.',ALARM:'LED nhấp nháy, còi kêu ngắt quãng. Cảnh báo giữ đến khi xác nhận.',SENSOR_FAULT:'Trạng thái chuyển động chưa xác định. Kiểm tra nguồn và dây SDA/SCL.'};
try{const saved=JSON.parse(localStorage.getItem('fallguard-config')||'null');if(saved){$('base-topic').value=saved.base;$('broker-url').value=saved.url;}}catch(_){}
const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const base=()=>$('base-topic').value.trim();
const sameConfig=()=>base()===activeBase&&$('broker-url').value.trim()===activeUrl;
const fresh=()=>connected&&availability!==false&&live&&Date.now()-lastReceive<8000;
const canCommand=()=>fresh()&&sameConfig()&&!pending;
const time=t=>new Date(t).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
function validState(v){
  if(!v||!/^[a-f0-9]{16}$/.test(v.session)||!Number.isInteger(v.uptime_ms)||v.uptime_ms<0||v.uptime_ms>4294967295)return false;
  for(const key of ['sensor_ok','calibrated','angle_valid','alarm','led','buzzer'])if(typeof v[key]!=='boolean')return false;
  if(!Object.hasOwn(labels,v.stage)||!['AUTO','MANUAL'].includes(v.mode)||!['MPU6050','TEST_FALL','TEST_BUMP','TEST_TILT'].includes(v.source))return false;
  if(!Number.isInteger(v.manual_remaining_s)||v.manual_remaining_s<0||v.manual_remaining_s>60||!Number.isInteger(v.fall_count)||v.fall_count<0)return false;
  if(v.sensor_ok&&(!finite(v.accel_g,0,14)||!finite(v.ax_g,-8.01,8.01)||!finite(v.ay_g,-8.01,8.01)||!finite(v.az_g,-8.01,8.01)||!finite(v.gyro_dps,0,900)||!finite(v.window_peak_g,0,14)))return false;
  if(v.sensor_ok&&v.calibrated&&v.angle_valid&&(!finite(v.tilt_deg,0,180)||!finite(v.roll_deg,-180,180)||!finite(v.pitch_deg,-90,90)||!finite(v.change_deg,0,180)))return false;
  return finite(v.event_peak_g,0,14);
}
function receiveState(v){
  if(!validState(v)){message='Bỏ qua bản tin không đúng định dạng FallGuard. Kiểm tra base topic và code ESP32.';render();return;}
  const now=Date.now();
  if(baseline&&baseline.session!==v.session&&pending){pending=null;message='ESP32 đổi phiên MQTT. Kiểm tra lại trạng thái trước khi gửi lệnh.';}
  const delta=baseline?(v.uptime_ms-baseline.uptime_ms)>>>0:0;
  live=!!baseline&&baseline.session===v.session&&delta>0&&delta<30000&&now-baseline.received<10000;
  baseline={session:v.session,uptime_ms:v.uptime_ms,received:now};state=v;lastReceive=now;
  if(pending&&pending.session===v.session&&pending.id===v.last_cmd){
    message=v.last_result==='OK'?'ESP32 đã xác nhận lệnh.':'ESP32 từ chối: '+String(v.last_result).slice(0,64);pending=null;
  }
  if(!history.length||history.at(-1).uptime!==v.uptime_ms||history.at(-1).session!==v.session){
    history.push({at:now,uptime:v.uptime_ms,session:v.session,a:v.sensor_ok?v.accel_g:null,p:v.sensor_ok?v.window_peak_g:null,t:v.sensor_ok&&v.calibrated&&v.angle_valid?v.tilt_deg:null});
    if(history.length>120)history.shift();drawCharts();
  }
  render();
}
function render(){
  const current=fresh(),valid=state?.sensor_ok===true,angle=valid&&state?.calibrated&&state?.angle_valid;
  $('connection').textContent=!connected?'MQTT chưa kết nối':current?'ESP32 trực tuyến':'Đã nối broker · chờ thiết bị';
  $('connection').className='badge '+(current?'good':!connected?'bad':'');
  const stage=state?.stage;
  const testSource=state?.alarm?state.alarm_source||state.source:state?.source;
  const isTest=String(testSource||'').startsWith('TEST_');
  $('source-label').textContent=!state?'CHỜ THIẾT BỊ':(isTest?'NGUỒN TEST · DỮ LIỆU THỬ':'NGUỒN MPU6050 · DỮ LIỆU CẢM BIẾN')+(!current?' · MẪU CŨ':'');
  $('stage-title').textContent=!state?'Chưa nhận dữ liệu':(isTest&&state.alarm?'TEST · cảnh báo té ngã mô phỏng':labels[stage]);
  $('stage-description').textContent=!state?'Chạy Wokwi và kết nối MQTT để bắt đầu giám sát.':(stage==='CALIBRATING'?descriptions[stage]+' '+(state.calibration_percent??0)+'%.':descriptions[stage]);
  $('status-panel').className='status-panel '+(state?.alarm?'alarm':stage==='VERIFY'?'verify':stage==='SENSOR_FAULT'?'fault':'');
  $('status-icon').textContent=state?.alarm?'!':stage==='READY'?'✓':stage==='VERIFY'?'⌁':'◌';
  $('event-count').textContent=(state?.fall_count??0)+' sự kiện · gồm các lần TEST';
  for(const [id,s] of [['step-cal','CALIBRATING'],['step-ready','READY'],['step-verify','VERIFY'],['step-alarm','ALARM']])$(id).className=stage===s?(s==='ALARM'?'alarm-current':'current'):'';
  let note=!connected?(message||'Chưa kết nối broker. Kiểm tra Internet và địa chỉ WSS.'):!sameConfig()?'Cấu hình đã thay đổi. Bấm Kết nối MQTT để áp dụng trước khi gửi lệnh.':!current?'Chờ hai bản tin mới để xác minh ESP32 đang trực tuyến. Dữ liệu retained không mở khóa điều khiển.':!valid?'Không có dữ liệu cảm biến hợp lệ; không thể xác nhận đang giám sát.':isTest?'DỮ LIỆU TEST: bài thử được tạo trong ESP32, không phải chuyển động đo từ người.':message||'Đang nhận dữ liệu trực tiếp. Các lệnh chỉ hoàn tất khi có xác nhận từ ESP32.';
  if(pending)note='Đã gửi lệnh · đang chờ ESP32 xác nhận…';
  $('notice').textContent=note;$('notice').className='notice '+(!current||!valid||isTest?'warn':'');
  function number(id,value,decimals,ok=true){$(id).textContent=ok&&typeof value==='number'?value.toFixed(decimals):'—';}
  number('accel',state?.accel_g,2,valid);number('ax',state?.ax_g,2,valid);number('ay',state?.ay_g,2,valid);number('az',state?.az_g,2,valid);
  number('gyro',state?.gyro_dps,1,valid);number('peak',state?.event_peak_g,2,!!state);
  number('tilt',state?.tilt_deg,1,angle);number('roll',state?.roll_deg,1,angle);number('pitch',state?.pitch_deg,1,angle);number('change',state?.change_deg,1,angle);
  $('angle-note').textContent=!state?.calibrated?'Chưa lấy được tư thế chuẩn':angle?'So với tư thế đứng đã hiệu chuẩn':'Đang động mạnh · không kết luận góc từ gia tốc';
  $('auto-btn').classList.toggle('selected',state?.mode==='AUTO');$('manual-btn').classList.toggle('selected',state?.mode==='MANUAL');
  $('auto-btn').disabled=!canCommand()||state?.mode==='AUTO';
  $('manual-btn').disabled=!canCommand()||!valid||!state?.calibrated||state?.alarm||state?.mode==='MANUAL';
  const remaining=state?.mode==='MANUAL'?Math.max(0,state.manual_remaining_s-Math.floor((Date.now()-lastReceive)/1000)):0;
  $('mode-help').textContent=state?.mode==='MANUAL'?'Thử LED/còi · về Auto sau khoảng '+remaining+'s. Phát hiện té ngã vẫn hoạt động.':'Phát hiện té ngã luôn hoạt động. Cảnh báo tự động có ưu tiên cao hơn Manual.';
  for(const [key,label] of [['led','LED'],['buzzer','còi']]){
    const on=state?.[key]===true,button=$(key+'-btn');
    $(key+'-state').textContent=!state?'Chưa rõ trạng thái':state.alarm?(key==='led'?'CẢNH BÁO · nhấp nháy':'CẢNH BÁO · kêu ngắt quãng'):(on?'ĐANG BẬT':'ĐANG TẮT')+(!current?' · mẫu cũ':'');
    $(key+'-state').className=on?'on':'';button.textContent=(on?'Tắt ':'Bật ')+label;button.classList.toggle('on',on);button.setAttribute('aria-pressed',String(on));
    button.disabled=!canCommand()||!valid||!state?.calibrated||state?.alarm||state?.mode!=='MANUAL';
  }
  $('ack-btn').disabled=!canCommand()||!(state?.alarm||stage==='VERIFY');
  $('calibrate-btn').disabled=!canCommand()||!valid||state?.alarm||state?.source!=='MPU6050';
  for(const id of ['test-fall','test-bump','test-tilt'])$(id).disabled=!canCommand()||!valid||!state?.calibrated||state?.alarm||state?.source!=='MPU6050';
  $('timing-note').textContent=state?'Khoảng lấy mẫu lớn nhất: '+(state.max_sample_gap_ms??'—')+'ms · '+(state.missed_samples??0)+' lần khoảng lấy mẫu >100ms. Mất mẫu có thể bỏ lỡ va đập.':'Chưa có thống kê lấy mẫu';
  $('chart-source').textContent=!state?'Chờ dữ liệu MQTT':isTest?'DỮ LIỆU TEST':current?'MQTT · trực tiếp':'Mẫu cũ / mất kết nối';
  $('last-seen').textContent=lastReceive?'Mẫu gần nhất '+time(lastReceive):'Chưa nhận mẫu nào';
}
function drawChart(id,key,color){
  const values=history.flatMap(p=>key==='a'?[p.a,p.p]:[p.t]).filter(v=>v!==null);
  let maximum=key==='t'?180:Math.max(4,Math.ceil(Math.max(0,...values)+0.5));
  const y=v=>153-v/maximum*130,x=i=>35+i*455/Math.max(1,history.length-1);let out='';
  for(let i=0;i<4;i++){let v=maximum*i/3,yy=y(v);out+='<line x1="35" x2="490" y1="'+yy+'" y2="'+yy+'" stroke="#edf1f5"/><text x="26" y="'+(yy+3)+'" fill="#a3aebb" font-size="9" text-anchor="end">'+v.toFixed(key==='a'?1:0)+'</text>';}
  const threshold=key==='a'?2.5:60;out+='<line x1="35" x2="490" y1="'+y(threshold)+'" y2="'+y(threshold)+'" stroke="#dfb183" stroke-dasharray="4 5"/><text x="487" y="'+(y(threshold)-4)+'" fill="#c0976f" font-size="8" text-anchor="end">'+threshold+(key==='a'?'g':'°')+'</text>';
  let path='',segment=false;history.forEach((p,i)=>{if(p[key]===null){segment=false;return;}path+=(segment?' L':' M')+x(i).toFixed(2)+','+y(p[key]).toFixed(2);segment=true;});
  if(path)out+='<path d="'+path+'" fill="none" stroke="'+color+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
  if(key==='a')history.forEach((p,i)=>{if(p.p!==null&&p.p>Math.max(1.2,(p.a??0)+0.1))out+='<circle cx="'+x(i)+'" cy="'+y(p.p)+'" r="2.6" fill="#dca06d"/>';});
  if(!values.length)out+='<text x="265" y="82" text-anchor="middle" fill="#a5b1bc" font-size="11">Chờ dữ liệu cảm biến</text>';
  $(id).innerHTML=out;
}
function drawCharts(){drawChart('accel-chart','a','#4e99b2');drawChart('tilt-chart','t','#7c96c0');document.querySelectorAll('.chart-first').forEach(e=>e.textContent=history.length?time(history[0].at):'Chờ mẫu đầu');document.querySelectorAll('.chart-last').forEach(e=>e.textContent=history.length?time(history.at(-1).at):'—');}
function connect(){
  let url=$('broker-url').value.trim(),topic=base();
  if(!/^wss:\/\//.test(url)||!/^[-a-zA-Z0-9_/]{1,120}$/.test(topic)||topic.startsWith('/')||topic.endsWith('/')){$('notice').textContent='Dùng URL wss:// và base topic hợp lệ (không có +, # hoặc dấu / ở hai đầu).';return;}
  try{new URL(url);}catch(_){$('notice').textContent='URL broker không hợp lệ.';return;}
  clearTimeout(retry);client?.disconnect();connected=false;availability=null;live=false;baseline=null;pending=null;state=null;history=[];lastReceive=0;activeBase=topic;activeUrl=url;message='Đang kết nối MQTT…';
  try{localStorage.setItem('fallguard-config',JSON.stringify({url,base:topic}));}catch(_){}
  const current=new MqttWire({url,base:topic,onReady(){if(current!==client)return;connected=true;message='Đã nối broker. Chờ dữ liệu từ ESP32…';render();},onMessage(t,payload){
    if(current!==client)return;
    if(t===topic+'/availability'){availability=payload==='online';if(!availability)live=false;render();}
    if(t===topic+'/state'){try{receiveState(JSON.parse(payload));}catch(_){message='Bản tin state không phải JSON hợp lệ.';render();}}
  },onError(text){if(current!==client)return;message=text;render();},onClose(){if(current!==client)return;connected=false;live=false;baseline=null;pending=null;render();retry=setTimeout(connect,5000);}});
  client=current;drawCharts();render();try{client.connect();}catch(e){message=e.message;render();}
}
function send(action,value){
  if(!canCommand()||!state)return;
  const command={id:'fg-'+Date.now().toString(36)+'-'+Math.random().toString(16).slice(2,8),session:state.session,action,value};
  try{client.publish(activeBase+'/cmd',JSON.stringify(command));pending={...command,at:Date.now()};message='';render();}catch(e){message='Gửi lệnh thất bại: '+e.message;render();}
}
$('settings-form').addEventListener('submit',event=>{event.preventDefault();connect();});
$('base-topic').addEventListener('input',render);$('broker-url').addEventListener('input',render);
$('auto-btn').onclick=()=>send('mode','AUTO');$('manual-btn').onclick=()=>send('mode','MANUAL');
$('led-btn').onclick=()=>send('led',!state.led);$('buzzer-btn').onclick=()=>send('buzzer',!state.buzzer);
$('ack-btn').onclick=()=>send('ack',true);$('calibrate-btn').onclick=()=>send('calibrate',true);
$('test-fall').onclick=()=>send('test','FALL');$('test-bump').onclick=()=>send('test','BUMP');$('test-tilt').onclick=()=>send('test','TILT');
setInterval(()=>{$('clock').textContent=new Date().toLocaleString('vi-VN');if(pending&&Date.now()-pending.at>10000){pending=null;message='Chưa có xác nhận sau 10s. Kiểm tra ESP32 trước khi gửi lại.';}render();},1000);
window.addEventListener('beforeunload',()=>client?.disconnect());drawCharts();render();connect();
