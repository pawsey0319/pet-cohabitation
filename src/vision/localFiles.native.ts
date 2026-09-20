import { Directory, File, Paths } from "expo-file-system";
/** Clear only this account's managed vision copies, including unsent photo drafts. */
export async function clearVisionLocalData(ownerId:string):Promise<void>{
 const segment=ownerId.replace(/[^a-zA-Z0-9_-]/g,"_");if(!segment)return;
 const root=new Directory(Paths.document,"pet-cohabitation-outbox");const folder=new Directory(root,segment);
 if(!folder.uri.startsWith(root.uri.replace(/\/$/,"")+"/")||!folder.exists)return;
 for(const file of folder.list())if(file instanceof File&&file.name.startsWith("vision-")&&file.uri.startsWith(folder.uri.replace(/\/$/,"")+"/"))file.delete();
}
