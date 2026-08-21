import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";

export function DevelopmentAttachmentPicker({name="attachments",label="Screenshots / Attachments",resetKey=0}:{name?:string;label?:string;resetKey?:number}){
  const input=useRef<HTMLInputElement>(null);const [files,setFiles]=useState<File[]>([]);const [previews,setPreviews]=useState<string[]>([]);
  useEffect(()=>{const next=files.map(file=>URL.createObjectURL(file));setPreviews(next);return()=>next.forEach(URL.revokeObjectURL);},[files]);
  useEffect(()=>{setFiles([]);if(input.current)input.current.value="";},[resetKey]);
  function apply(next:File[]){const accepted=next.filter(file=>["image/png","image/jpeg","image/webp"].includes(file.type)).slice(0,8);setFiles(accepted);if(input.current){const transfer=new DataTransfer();accepted.forEach(file=>transfer.items.add(file));input.current.files=transfer.files;}}
  function append(values:File[]){apply([...files,...values.filter(file=>!files.some(existing=>existing.name===file.name&&existing.size===file.size))]);}
  function onPaste(event:ClipboardEvent<HTMLDivElement>){const images=Array.from(event.clipboardData.files);if(images.length){event.preventDefault();append(images);}}
  function onDrop(event:DragEvent<HTMLDivElement>){event.preventDefault();append(Array.from(event.dataTransfer.files));}
  return <div className="attachment-dropzone" tabIndex={0} onPaste={onPaste} onDragOver={event=>event.preventDefault()} onDrop={onDrop}>
    <label>{label}<input ref={input} name={name} type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={event=>apply(Array.from(event.currentTarget.files||[]))}/></label>
    <small>Paste, drag/drop, or choose up to 8 PNG, JPEG, or WEBP images.</small>
    <div className="attachment-preview-strip">{files.map((file,index)=><figure key={`${file.name}-${file.size}`}><img src={previews[index]} alt=""/><figcaption>{file.name}</figcaption><button type="button" onClick={()=>apply(files.filter((_,item)=>item!==index))}>Remove</button>{index>0?<button type="button" onClick={()=>{const next=[...files];[next[index-1],next[index]]=[next[index],next[index-1]];apply(next);}}>Earlier</button>:null}</figure>)}</div>
  </div>;
}
