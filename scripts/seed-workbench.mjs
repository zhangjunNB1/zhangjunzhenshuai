import fs from 'node:fs/promises';
import {createWorkspace} from '../src/workbench-model.ts';
const target=new URL('../data/workbench.json',import.meta.url);
try{await fs.access(target);console.log('Published workspace already exists; preserved.');}
catch{const manifest=JSON.parse(await fs.readFile(new URL('../data/manifest.json',import.meta.url),'utf8'));const snapshot=JSON.parse(await fs.readFile(new URL('../data/'+manifest.snapshots.at(-1).file,import.meta.url),'utf8'));const workspace=createWorkspace(snapshot,manifest);await fs.writeFile(target,JSON.stringify(workspace));console.log(JSON.stringify({products:workspace.products.length,costs:workspace.costs.length,unknownCosts:true}));}
