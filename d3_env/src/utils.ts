import * as d3 from "d3";
import {margin, width, height} from './constants.mjs';
import { DefaultMap } from "./map_extensions";


export type TooltipDiv = d3.Selection<HTMLDivElement, unknown, HTMLElement, any>;
export type SVGSelection = d3.Selection<SVGGElement, unknown, HTMLElement, any>;

export function clamp(val: number, min: number, max: number) {
    return Math.max(min, Math.min(val, max));
}

export function clampX(val: number, margin=0) {
    const r = margin ? Math.floor(margin * Math.random()) : 0;
    return clamp(val, r, width + r);
}

export function clampY(val: number, margin?: number) {
    const r = margin ? Math.floor(margin * Math.random()) : 0;
    return clamp(val, r, height + r);
}

export function topGroups(arr, key, n, comp) {
    const defaultComp = (a, b) => b.length - a.length;
    const groups = groupby(arr, key);
    const top = Object.values(groups).sort(comp || defaultComp).slice(0, n);
    return top
}

export function groupby(arr: Object[], groupKey: string) {
    const keys = new Set(arr.map(i => i[groupKey]).filter(e => e !== null));
    const map = Object.fromEntries(Array.from(keys).map(k => [k, []]));
    for (const obj of arr) {
        if (obj[groupKey] !== null)
            map[obj[groupKey]].push(obj);
    }
    return map;
}

export function count<T>(arr: T[]): Map<T, number> {
    return arr.reduce(
        (acc, e) => acc.update(e, x => x+1),
        new DefaultMap<T, number>(0)
    );
}

export function groupbyMultiple(arr, groupKeys) {
    function getKeysVal(o) {
        return JSON.stringify(groupKeys.map(k => o[k]))
    }
    const keys = new Set(arr.map(getKeysVal));
    const map = Object.fromEntries(Array.from(keys).map(k => [k, []]));
    for (const obj of arr) {
        map[getKeysVal(obj)].push(obj);
    }
    return map;
}

export function getSvg(id: string): SVGSelection {
    const existing = d3.select("#" + id);
    if (!existing.empty()) 
        existing.remove();
   
    return d3.select("body")
        .append('svg')
        .attr("id", id)
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left}, ${margin.top})`);
}

export function createSVG(ref): SVGSelection {   
    
    return d3.select(ref)
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left}, ${margin.top})`);

}

export function createTooltip() {
    return d3.select("body")
        .append("div")
        .attr("class", "tooltip")
        .style("opacity", 0);
}


export function onMouseover(div: TooltipDiv, textFunc=(_) => "...") {
    return (event, data) => {
        div.transition()
            .duration(100)
            .style("opacity", 1);
        div.html(textFunc(data))
            .style("left", (event.pageX) + "px")
            .style("top", (event.pageY - 28) + "px");
    }  
}
export function onMouseout(div: TooltipDiv) {
    return (_event, _data) => {
        div.transition()
            .duration(100)
            .style("opacity", 0);
    }       
}
    
export function onMousemove(div: TooltipDiv) {
    return (event, _data) => {
        div
        .style("left", (event.pageX) + "px")
        .style("top", (event.pageY - 28) + "px");
    }
}

/*
    BEGIN SET OPERATIONS
*/
export function bothDifference<T>(A: Set<T>, B: Set<T>): [Set<T>, Set<T>] {
    let [AdB, BdA] = [new Set(A), new Set<T>()];
    for (let b of B) {
        if (!AdB.delete(b)) BdA.add(b);
    }
    return [AdB, BdA];
}

// From: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set
export function union<T>(setA: Set<T>, setB: Set<T>): Set<T> {
    let _union = new Set(setA)
    for (let elem of setB) {
        _union.add(elem)
    }
    return _union
}

// From: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set
export function intersection<T>(setA: Set<T>, setB: Set<T>): Set<T> {
    let _intersection = new Set<T>()
    for (let elem of setB) {
        if (setA.has(elem)) {
            _intersection.add(elem)
        }
    }
    return _intersection
}

/*
    END SET OPERATIONS
*/

export function debounce(f: (...args: any[]) => void, time=1000) {
    let timeout = null;
    function debounced(...args: any[]) {
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(() => f(...args), time);
    }
    return debounced;
}

export function d3Translate({x, y}: {x: number, y: number}) {
    return `translate(${x}, ${y})`;
}