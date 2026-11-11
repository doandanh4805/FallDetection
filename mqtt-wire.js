/* Minimal MQTT 3.1.1 transport, no CDN. QoS 0 commands, QoS 0 subscriptions.
 * Handles fragmented/combined packets. Dedicated to a public educational broker.
 */
(function(root) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const join = (...arrays) => {
    const out = new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));
    let at=0; for(const a of arrays){out.set(a,at);at+=a.length;} return out;
  };
  function str(s){const bytes=enc.encode(s);if(bytes.length>65535)throw Error('String too long');return join(Uint8Array.of(bytes.length>>8,bytes.length&255),bytes);}
  function packet(header,body){let n=body.length,len=[];do{let b=n%128;n=Math.floor(n/128);if(n)b|=128;len.push(b);}while(n);return join(Uint8Array.of(header,...len),body);}
  class MqttWire {
    constructor({url,base,onReady,onMessage,onClose,onError,Socket=root.WebSocket}) {
      Object.assign(this,{url,base,onReady,onMessage,onClose,onError,Socket});
      this.ready=false;this.rx=new Uint8Array();this.closed=false;this.waitingPing=false;
    }
    connect(){
      this.ws=new this.Socket(this.url,['mqtt']);this.ws.binaryType='arraybuffer';
      this.ws.onopen=()=>{
        const id='garden-web-'+Math.random().toString(16).slice(2,14);
        this.send(0x10,join(str('MQTT'),Uint8Array.of(4,2,0,30),str(id)));
      };
      this.timeout=setTimeout(()=>this.fail('Quá thời gian kết nối MQTT'),12000);
      this.ws.onmessage=(event)=>{try{this.receive(new Uint8Array(event.data));}catch(e){this.fail(e.message);}};
      this.ws.onerror=()=>this.onError?.('Không kết nối được WebSocket; kiểm tra Internet / broker.');
      this.ws.onclose=()=>{this.cleanup();if(!this.closed)this.onClose?.();};
    }
    send(h,b=new Uint8Array()){if(this.ws?.readyState!==1)throw Error('WebSocket chưa mở');this.ws.send(packet(h,b));}
    receive(bytes){
      this.rx=join(this.rx,bytes);
      while(this.rx.length>=2){
        let length=0,mul=1,i=1,b;
        do {if(i>=this.rx.length)return;b=this.rx[i++];length+=(b&127)*mul;mul*=128;if(i>5)throw Error('MQTT length không hợp lệ');}while(b&128);
        if(length>1048576)throw Error('MQTT packet quá lớn');
        if(this.rx.length<i+length)return;
        const header=this.rx[0], body=this.rx.slice(i,i+length);
        this.rx=this.rx.slice(i+length);this.handle(header,body);
      }
    }
    handle(h,b){
      const type=h>>4;
      if(type===2){
        if(b.length!==2 || b[1]!==0)throw Error('Broker từ chối CONNECT');
        this.send(0x82,join(Uint8Array.of(0,1),str(this.base+'/#'),Uint8Array.of(0)));
      }else if(type===9){
        if(b.length<3 || b[0]!==0 || b[1]!==1 || b[2]===128)throw Error('Broker từ chối SUBSCRIBE');
        if(this.ready)return;
        clearTimeout(this.timeout);this.ready=true;this.onReady?.();
        this.ping=setInterval(()=>{if(this.waitingPing){this.fail('Broker không trả lời PING');return;}this.waitingPing=true;try{this.send(0xc0);}catch(e){this.fail(e.message);}},15000);
      }else if(type===3){
        if(b.length<2)throw Error('PUBLISH không hợp lệ');
        const n=(b[0]<<8)|b[1];let start=2+n;const qos=(h>>1)&3;
        if(start>b.length || qos===3)throw Error('PUBLISH topic không hợp lệ');
        let id;if(qos){if(start+2>b.length)throw Error('PUBLISH thiếu packet id');id=b.slice(start,start+2);start+=2;}
        this.onMessage?.(dec.decode(b.slice(2,2+n)),dec.decode(b.slice(start)),!!(h&1));
        if(qos===1)this.send(0x40,id);
        if(qos===2)throw Error('QoS 2 không được dùng trong dashboard');
      }else if(type===13){this.waitingPing=false;}
    }
    publish(topic,value){if(!this.ready)throw Error('MQTT chưa sẵn sàng');this.send(0x30,join(str(topic),enc.encode(value)));} // retain=false
    cleanup(){this.ready=false;clearTimeout(this.timeout);clearInterval(this.ping);}
    fail(message){this.onError?.(message);this.ws?.close();this.cleanup();}
    disconnect(){this.closed=true;try{if(this.ready)this.send(0xe0);}catch(_){}this.cleanup();this.ws?.close();}
  }
  root.MqttWire=MqttWire;
  if(typeof module!=='undefined')module.exports={MqttWire,packet,str,join};
})(typeof globalThis!=='undefined'?globalThis:window);
