import { useEffect, useState } from 'react'
import { fetchMenuCatalog } from '../services/menuService'
export function useMenuCatalog(){const [state,setState]=useState({products:[],categories:['All'],loading:true,error:''});useEffect(()=>{let active=true;fetchMenuCatalog().then(data=>{if(active)setState({...data,loading:false,error:''})}).catch(error=>{if(active)setState(current=>({...current,loading:false,error:error.message||'Unable to load the menu.'}))});return()=>{active=false}},[]);return state}
