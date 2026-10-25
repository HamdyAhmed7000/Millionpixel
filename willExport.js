// All exports are built locally; text is rendered into the image so Arabic stays intact.
const encoder=new TextEncoder();
const bytes=data=>Uint8Array.from(atob(data.split(',')[1]),x=>x.charCodeAt(0));
export function willExports(canvas){
 const image=canvas.toDataURL('image/png'),jpeg=bytes(canvas.toDataURL('image/jpeg',.95));
 const chunks=[],offsets=[0];let size=0;
 const put=x=>{const b=typeof x==='string'?encoder.encode(x):x;chunks.push(b);size+=b.length;};
 const object=(id,body)=>{offsets[id]=size;put(id+' 0 obj\n');put(body);put('\nendobj\n');};
 put('%PDF-1.4\n');object(1,'<< /Type /Catalog /Pages 2 0 R >>');object(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
 object(3,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Photo 4 0 R >> >> /Contents 5 0 R >>');
 offsets[4]=size;put('4 0 obj\n<< /Type /XObject /Subtype /Image /Width '+canvas.width+' /Height '+canvas.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpeg.length+' >>\nstream\n');put(jpeg);put('\nendstream\nendobj\n');
 const stream='q\n547.28 0 0 684.10 24 78.89 cm\n/Photo Do\nQ\n';object(5,'<< /Length '+encoder.encode(stream).length+' >>\nstream\n'+stream+'endstream');
 const start=size;put('xref\n0 6\n0000000000 65535 f \n');for(let i=1;i<=5;i++)put(String(offsets[i]).padStart(10,'0')+' 00000 n \n');put('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF');
 return {image,png:URL.createObjectURL(new Blob([bytes(image)],{type:'image/png'})),pdf:URL.createObjectURL(new Blob(chunks,{type:'application/pdf'}))};
}
