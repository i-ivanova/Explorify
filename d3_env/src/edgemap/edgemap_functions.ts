import * as drResults from '../../../data/dr_results.json'
import * as d3 from "d3";
import * as utils from './utils';
import { width, height, maxDistance, alphaMin, alphaDecay, transitionTime, timeAxisDivisions, EMViewToPositionKey} from './constants';
import {DefaultMap} from '../map_extensions';
import '../map_extensions.ts';
import { StreamInstance, artistData, streamingHistoryNoSkipped, artistID, artistMap} from '../data'
import { artistStreamTimes, artistToGenres, firstArtistStream, getTimePolyExtent } from '../derived_data';
import { Ref } from 'react';
import Quadtree from '@timohausmann/quadtree-js';
import { quadtree } from 'd3';

/**
 * A feature vector reduced to 2 dimensions. Must be mapped to fit within chart.
 */
type Position = {x: number, y: number};
type DRCoordinate = [number, number];
type Node = {
    id: string,
    name: string,
    r: number,
    genrePos: Position,
    timelinePos: Position,
    featurePos: Position,
    firstStream: Date,
    
    // shorthand for similarity view equivalents
    x: number,
    y: number,
};
type Link = {
    id: string, // source and target ids (in that order) combined
    source: Node["id"],
    target: Node["id"],
    label: string,
    count: number,
    proportion: number
}
type Network = {
    nodes: Node[], 
    links: Link[]
};

type d3Node = Node & d3.SimulationNodeDatum;
type d3Link = Link & {
    index: number,
    source: d3Node,
    target: d3Node
}

type d3Selection = d3.Selection<any, any, any, any>;

const sessions = getSessions();
const sessionArtists = sessions.map(sesh => sesh.map(stream => stream.artistID));
const sessionOccurrences = new Map(
    artistData.map(artist => 
        [artist.id, sessionArtists.reduce((count, as) => count + +as.includes(artist.id), 0)]
    )
);


/*
 * Important decisions:
 *      Value of maxPause: how long a pause in a session can be.
 *      Use streamingHistory vs streamingHistoryNoSkipped
 */
function getSessions(): StreamInstance[][] {
    function inSession(stream: StreamInstance, session: StreamInstance[]): boolean {
        const lastStreamTime = session[session.length - 1].endTime.getTime();
        const sessionEndTime = lastStreamTime + stream.msPlayed + maxPause
        return  stream.endTime.getTime() <= sessionEndTime;
    }

    const streams = streamingHistoryNoSkipped.slice().sort((s1, s2) => s2.endTime.getTime() - s1.endTime.getTime());
    const maxPause = 2 * 60_000; // 60_000ms is one minute
    const sessions = [];
    let currentSesh = [streams.pop()];
    
    // Consider using streamingHistoryNoSkip instead
    for (const stream of streams.reverse()) {
        if (inSession(stream, currentSesh))
            currentSesh.push(stream);
        else {
            sessions.push(currentSesh);
            currentSesh = [stream];
        }
    }
    sessions.push(currentSesh);
    return sessions
}

/**
 * Returns a map from artist id to another map.
 * The inner map is a mapping from all artists which the original artist
 * has occurred in a session with to the number of sessions in which they occurred together. 
 * 
 * Note: Edges are kinda directed. Always in pairs, but values may not be equal
 */
function computeSessionLinks(): Link[] {  
    const coPlays = new DefaultMap<artistID, artistID[]>([]);
    for (const artists of sessionArtists) {
        const artistSet = new Set(artists);
        artistSet.forEach(a1 => 
            artistSet.forEach(a2 => {
                    if (a1 !== a2)
                        coPlays.update(a1, s => s.concat(a2))
                })
        );
    }

    const coPlayCounts: [artistID, Map<artistID, number>][] = Array.from(coPlays).map(
        ([a1, as]) => [a1, utils.count(as)]
    );

    const links = coPlayCounts.flatMap(([a1, neighbors]) => 
        Array.from(neighbors).map(([a2, count]) => ({
            id: a1 + a2,
            source: a1,
            target: a2,
            label: "???",
            count: count,
            proportion: count / sessionOccurrences.get(a1)
        }))
    )

    return links;
}

function toPolar(x: number, y: number): [number, number] {
    const [cx, cy] = [x - width/2, y - height/2];  // center coordinates
    const distance = Math.sqrt(cx*cx + cy*cy);
    const distNormalized = distance / maxDistance;
    const radians = Math.atan2(cy, cx);
    const degrees = (radians * (180 / Math.PI)) % 360;
    return [distNormalized, degrees];
}

/**
 * 
 * @param param0 x and y coordinates of a point, normalized to fit inside svg coordinates 
 */
export type NodePositionKey = "genrePos" | "featurePos" | "timelinePos";
function createGetColor(positionKey: NodePositionKey) {
    if (positionKey === "timelinePos") {
        // const scale = d3.scaleLinear().domain([width, 0]);
        const scale = d3.scaleLinear().domain([0, width]);
        // const colorScale = d3.interpolateYlGnBu;
        const colorScale = d3.interpolateCividis;
        return (node: Node) => {
            return colorScale(scale(node.timelinePos.x));
        }
    }
    return (node: Node) => {
        const {x, y} = node[positionKey];
        const [dist, deg] = toPolar(x, y);
        return d3.hsl(deg, dist, 0.6, 1)
    }
}

let getColor = createGetColor("genrePos");
export function setNodeColorKey(key: NodePositionKey) {
    getColor = createGetColor(key);
    setLinks(edgemapState.links);
    highlightSelection(edgemapState.selected);
    if (!edgemapState.selected)
        dropSelectionHighlight();
}


const completeNetwork: Network = computeNetwork();

function computeNetwork(): Network {    
    const genrePositions = (() => {
        const data: Map<artistID, DRCoordinate> = new Map(drResults.map(
            res => [res.artist_id, res.tsne_genre_no_outliers as DRCoordinate]
        ));
        const values = Array.from(data.values()).filter(v => v !== null);
        const xAxis = d3.scaleLinear().domain(d3.extent(values.map(([x,]) => x))).range([0, width]);
        const yAxis = d3.scaleLinear().domain(d3.extent(values.map(([, y]) => y)).reverse()).range([0, height]);
        return new Map(
            Array.from(data)
                .filter(([, pos]) => pos !== null)
                .map(([id, [x, y]])=> [id, {x: xAxis(x), y: yAxis(y)}])
        );
    })();
    
    const featurePositions = (() => {
        const data: Map<artistID, DRCoordinate> = new Map(drResults.map(
            res => [res.artist_id, res.tsne_feature as DRCoordinate]
        ));
        const values = Array.from(data.values()).filter(v => v !== null);
        const xAxis = d3.scaleLinear().domain(d3.extent(values.map(([x,]) => x))).range([0, width]);
        const yAxis = d3.scaleLinear().domain(d3.extent(values.map(([, y]) => y)).reverse()).range([0, height]);
        return new Map(
            Array.from(data)
                .filter(([, pos]) => pos !== null)
                .map(([id, [x, y]])=> [id, {x: xAxis(x), y: yAxis(y)}])
        );
    })();

    const timelineAxis = d3.scaleTime().domain(getTimePolyExtent(timeAxisDivisions)).range(utils.divideWidth(timeAxisDivisions));
    const nodeSizes = d3.scaleSqrt().domain(d3.extent(artistStreamTimes.values())).range([5, 20])
    
    
    const artistSet = utils.intersection(new Set(genrePositions.keys()), new Set(featurePositions.keys()));
    // TODO: This currently excludes genre_tsne outlier artists and artists missing features. FIX
    const nodes = Array.from(artistSet)
        .map(aid => genrePositions.get(aid) && ({
            id: aid,
            name: artistMap.get(aid),
            r: nodeSizes(artistStreamTimes.get(aid)),
            genrePos: genrePositions.get(aid),
            featurePos: featurePositions.get(aid),
            timelinePos: {x: timelineAxis(firstArtistStream.get(aid)), y: height/2},
            firstStream: firstArtistStream.get(aid),

            ...genrePositions.get(aid) // x & y coords default to genrePosition
        }))
    .filter(v => v !== null && v !== undefined);
    
    const links = Array.from(artistSet).flatMap(a1 => 
        Array.from(artistSet).flatMap(a2 => {
            if (a1 === a2) return; 
            const [gs1, gs2] = [artistToGenres.get(a1), artistToGenres.get(a2)];
            const shared = utils.intersection(gs1, gs2);
            if (!shared.size) return;
            return {
                    id: a1 + a2,
                    source: a1,
                    target: a2,
                    label: Array.from(shared).join(" | "),
                    count: utils.intersection(gs1, gs2).size,
                    proportion: (() => {
                        // Jaccard Similarity: 
                        return shared.size / utils.union(gs1, gs2).size;
                        // Overlap Coefficient: return utils.intersection(gs1, gs2).size / Math.min(gs1.size, gs2.size);
                    })()
                };
        }
    ))
    .filter(x => x !== null && x != undefined);      

    return {
        nodes: nodes,
        links: links
    }
}

/**
 * It's a huge pain to pass around all the information that's needed to update the network correctly.
 * So instead, we just store all the information in this global object. 
 */
let edgemapState = {
    svg: null,
    artistSet: new Set(),
    nodes: [],
    links: [],
    node: null,
    link: null,
    _simulation: null,
    selected: null,
    selectedNeighbors: new Set<artistID>(),
    currentView: "genreSimilarity",
    timelineAxis: null,
    quadTree: null,
    showLabels: true,
};

function setSimulation(simulation: d3.Simulation<any, any>, dontStart=false) {
    if (edgemapState._simulation) edgemapState._simulation.stop();
    edgemapState._simulation = simulation;
    if (!dontStart) simulation.restart();
}

const deselectHSL = d3.hsl(0.5, 0.5, 0.35, 0.2);
function highlightSelection(selected: d3Node) {
    if (selected === null || selected === undefined) return;
    
    // If new node is being selected
    if (edgemapState.selected !== selected) dropSelectionHighlight();
    
    const {node, link, links} = edgemapState;

    link.style("visibility", (l: d3Link) => l.source.id === selected.id ? "visible" : "hidden");
    hideLinkLabels();

    const neighbors = new Set(
        links.filter((l: d3Link) => l.source.id === selected.id).map(l => l.target.id)
    ).add(selected.id);
    
    node
        .selectChildren("circle") 
        .style("fill", (n: d3Node) => neighbors.has(n.id) ? getColor(n) : deselectHSL);

    if (edgemapState.showLabels) 
        showNodeLabels(node.filter((n: d3Node) => neighbors.has(n.id)));
  
    const selectedNode = node.filter((n: d3Node) => n.id === selected.id);
    selectedNode.selectChildren("circle")
        .style("stroke-width", 3)
        .style("stroke", getColor)
        .style("fill", "white");


    edgemapState.selectedNeighbors = neighbors;
    edgemapState.selected = selected;
}

function dropSelectionHighlight() {
    const {node, link, selectedNeighbors, selected, showLabels} = edgemapState;
    
    link.style("visibility", "hidden");
    node.selectChildren("circle").style("fill", getColor);
    
    if (selected !== null) {
        const neighbors = node.filter((n: d3Node) => selectedNeighbors.has(n.id));
        neighbors.selectChildren("text").style("visibility", "hidden");
    
        neighbors.filter((n: d3Node) => n.id === selected.id)
            .selectChildren("circle")
            .style("stroke-width", 0);
    }

    if (showLabels) showNodeLabels(node);

    edgemapState.selected = null;
    edgemapState.selectedNeighbors.clear();
}

function addNodes(svg: utils.SVGSelection, nodes: d3Node[]) {
    function onMouseover(_e: PointerEvent, n: d3Node) {   
        const {node} = edgemapState;
        
        const current = node.filter((_n: d3Node) => _n.id === n.id);
        current
            .selectChildren("text")
            .style("visibility", "visible")
    }
    function onMouseout(_e: PointerEvent, n: d3Node) {
        const {node, showLabels} = edgemapState;
        const current = node.filter((_n: d3Node) => _n.id === n.id);
        current
            .selectChildren("text")
            .style("visibility", (_n: d3Node) => {
                const circle: HTMLElement = this;
                const text = circle.nextSibling as HTMLElement
                if (!edgemapState.selected) {
                    if (showLabels && !itemOverlaps(text)) {
                        edgemapState.quadTree.insert(text.getBoundingClientRect());
                        return "visible";                    
                    }
                    return "hidden";
                }
                if (!edgemapState.selectedNeighbors.has(_n.id) || itemOverlaps(text)) {
                    return "hidden";
                }
                return "visible";
            });
    }
    const {selected} = edgemapState;

    const node = svg
        .selectAll("node") // @ts-ignore
        .data(nodes, (n: d3Node) => n.id)
        .enter()
        .append("g")
        .attr("id", n => n.id)
        .attr("class", "node");
    // @ts-ignore
    node.append("circle")
        .attr("r", n => n.r)
        .style("fill", n => selected ? deselectHSL : getColor(n))
        .on("mouseover", onMouseover)
        .on("mouseout", onMouseout)
        .on("click", (_event, n) => highlightSelection(n));
    node
        .append("text")
        .text((d: Node) => d.name)
        .attr("class", "node-text")
        .attr("class", "unselectable")
        .on("mouseover", onMouseover)
        .on("mouseout", onMouseout)
        .style("visibility", "hidden");
    
    return node
}

// Use this approach to display genres along link paths: https://css-tricks.com/snippets/svg/curved-text-along-path/
function setLinks(links: d3Link[]) {
    const getLinkColor = (color) => d3.scaleLinear().range([color, "black"])
    const onEnter = (selection) => {
        const linkNode = selection.append("g");
        linkNode
            .attr("class", "link-node")
            .style("visibility", "hidden");
        linkNode
            .append("path")
            .attr("id", (l: Link) => l.id)
            .attr("class", "link-path")
            .style("fill", "none")
            .style("opacity", 0.9)
            .style("stroke", (l: d3Link) => getLinkColor(getColor(l.target))(l.proportion))
            .style("stroke-width", (l: d3Link) => Math.log2(l.count) + 1);
        linkNode
            .append("text")
                .attr("class", "link-text")
            .append("textPath")
                .attr("alignment-baseline", "top")
                .attr("startOffset", () => ((Math.random() * 30 + 10) + "%"))
                .attr("xlink:href", (l: Link) => "#"+l.id)
            .text((l: Link) => l.label)
                .style("fill", (l: d3Link) => getLinkColor(getColor(l.target))(l.proportion));
        
        
        return linkNode;
    }

    const link = (edgemapState.svg as utils.SVGSelection)
        .selectAll(".link-node")
        .data(links)
        .join(
            enter => onEnter(enter)
                .lower(), // re-insert links as the first child of svg, so that links are drawn first (and thus behind other objects)
            update => update
                .style("fill", (l: d3Link) => getLinkColor(getColor(l.target))(l.proportion))
                // 
                ,
            exit => exit.remove()
        );

    link.selectChildren("path")
        .style("stroke", (l: d3Link) => getLinkColor(getColor(l.target))(l.proportion));
    link.selectChildren("textPath")
        .style("fill", (l: d3Link) => getLinkColor(getColor(l.target))(l.proportion));

    return link;
}

function computeCurve(d: d3Link) {
    const [dx, dy] = [d.target.x - d.source.x, d.target.y - d.source.y];
    const dr = Math.sqrt(dx*dx + dy*dy);  
    const curveRight = +(d.target.x < d.source.x) + 0;
    return `M${d.source.x},${d.source.y}A${dr},${dr} 0 0,${curveRight} ${d.target.x},${d.target.y}`
}

/*
 * Important decisions:
 *      which DR result to use
 * TODO: 
 *      Link thickness by session co-occurrences
 *      Link color by proportion of co-occurrences
 *      Link color is gradient interpolated from source and target colors
 *          See: https://stackoverflow.com/questions/20706603/d3-path-gradient-stroke
 */
const top150 = Array.from(artistStreamTimes.keys()).slice(0, 150);
export function setupEdgemap(ref: SVGElement, artists: artistID[]) {    
    const artistSet = new Set(artists);
    const nodes = completeNetwork.nodes.filter(n => artistSet.has(n.id)).map(x => ({...x}));
    const links = completeNetwork.links.filter(l => artistSet.has(l.source) && artistSet.has(l.target)).map(x => ({...x}));

    const svg = utils.createSVG(ref);
    
    const background = svg.append("rect").attr("width", width).attr("height", height).style("opacity", 0);
    background.on("click", dropSelectionHighlight);
    
    const simulation = similaritySimulation({nodes, links});
    
    edgemapState.svg = svg
    const link = setLinks(links as d3Link[]);
    const node = addNodes(svg, nodes as d3Node[]);

    // Use coordinate space of the whole browser, as these are easier to get for each element. 
    const quadTree = new Quadtree(
        document.getElementsByTagName("body")[0].getBoundingClientRect()
    );


    const timelineAxis = svg.append("g")
        .attr("transform", `translate(0, ${height/2})`)
        .style("visibility", "hidden")
        .call(d3.axisBottom(d3.scaleTime().domain(getTimePolyExtent(timeAxisDivisions)).range(utils.divideWidth(timeAxisDivisions)))); 

    edgemapState = {...edgemapState, artistSet, node, link, nodes, links, svg, timelineAxis, quadTree};
    setSimulation(simulation);
}

function makeRestrictedTick(tickFunc: (node: d3Selection, link: d3Selection) => void) {
    let prevPositions = null;
    function ticked() {
        const {node, link, nodes, _simulation} = edgemapState;
        
        tickFunc(node, link);
        
        if (prevPositions !== null) {
            const cutoff = 0.01 * nodes.length;
            const movement = nodes.reduce(
                (sum, n, i) => sum + Math.abs(n.x - prevPositions[i][0]) + Math.abs(n.y - prevPositions[i][1]),
                0
            )            
            // if (movement < cutoff) _simulation.alphaTarget(_simulation.alphaTarget()); // stops the simulation
            if (movement < cutoff) {
                // Set current alpha lower than the stopping alpha, stopping the simulation "naturally"
                this.alpha(this.alphaMin() / 2);
            }
        }
        prevPositions = nodes.map(n=> [n.x, n.y]);
    }
    // return ticked;

    return () => {
        const { node, link } = edgemapState;
        tickFunc(node, link);
    }
}

function similaritySimulation({nodes, links}: Network) {
    let first = true; // compute edges on initial tick. Solves visual bug where edges appear to not update after transition.
    const ticked = makeRestrictedTick((node, link) => {        
        console.log("similarity");
        if (first) {
            first = false;
            computeEdges();
        }
        node.attr("transform", (d: d3Node) => 
                `translate(${utils.clampX(d.x)}, ${utils.clampY(d.y)})`
            );
        } 
    )
    const computeEdges = () => {
        const {link} = edgemapState;
        link.selectChildren("path").attr("d", computeCurve)
    }

    return d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => (d as Node).id).strength(0))
        .force("collide", d3.forceCollide(n => n.r + 2))
        .alphaMin(alphaMin)
        .alphaDecay(alphaDecay)
        .on("tick", ticked)
        .on("end", computeEdges)
        .stop();
}

// If a node is highlighted, return a selection of  it and its neighbors. Otherwise, return selection of all nodes
function getNodeToLabel() {
    const {node, selected, selectedNeighbors} = edgemapState;
    return selected ? node.filter((n: d3Node) => selectedNeighbors.has(n.id)) : node;
}

function timelineSimulation({nodes, links}: Network) {
    let first = true;
    const ticked = makeRestrictedTick((node, _link) => {
        console.log("timeline");
        if (first) {
            first = false;
            computeEdges();
        }
        node.attr("transform", (d: d3Node) => `translate(${d.x}, ${utils.clampX(d.y)})`);
    });

    const computeEdges = () => {
        const {link} = edgemapState;
        link.selectChildren("path").attr("d", computeCurve)
    }
        
    return  d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => (d as Node).id).strength(0))
        .force("collide", d3.forceCollide(n => n.r + 1))
        .force("anchor", d3.forceX(n => n.x).strength(3))
        .alphaMin(alphaMin)
        .alphaDecay(alphaDecay)
        .on("tick", ticked)
        .on("end", computeEdges)
        .stop();
}

type Box = {x: number, y: number, width: number, height: number};
function overlap(r1: Box) {
    return (r2: Box) => {
        const xOverlap = r1.x < (r2.x + r2.width) && r2.x < (r1.x + r1.width);
        const yOverlap = r1.y < (r2.y + r2.height) && r2.y < (r1.y + r1.height);
        return xOverlap && yOverlap;
    }
}

function itemOverlaps(htmlNode: HTMLElement, quadTree?: Quadtree) {
    const qTree = quadTree || edgemapState.quadTree;
    const bbox = htmlNode.getBoundingClientRect();
    
    return qTree.retrieve(bbox)
        .filter((rect: Box) => bbox.x !== rect.x && bbox.y !== rect.y) // don't collide with self
        .some(overlap(bbox));
}

// Quadtree implementation: https://github.com/timohausmann/quadtree-js/
function showNodeLabels(node) {
    const {quadTree} = edgemapState;
    quadTree.clear();

    // edgemapState.node.selectChildren("text").style("visibility", "hidden");
    node.selectChildren("text").style("visibility", "hidden");

    const text = node.selectChildren("text");
    text.nodes().forEach(n => {
        const bbox = n.getBoundingClientRect();
        
        if (!quadTree.retrieve(bbox).some(overlap(bbox))) {
            n.style.visibility = "visible";
            quadTree.insert(bbox);
        }
            
    });
    
    edgemapState.quadTree = quadTree;
}

function hideLinkLabels() {
    const {width, height} = document.getElementsByTagName("body")[0].getBoundingClientRect();
    const quadTree = new Quadtree({x: 0, y: 0, width, height});

    function sortByGenres(nodes) {
        const nodeGenres = new Map<any, string[]>(nodes.map(n => [n, n.getInnerHTML().split(" | ")]));
        const sorted = nodes.sort((n1, n2) => nodeGenres.get(n2).length - nodeGenres.get(n1).length);
        return sorted
        
    }
    const link = edgemapState.link;
    const textPaths = link.nodes()
        .filter(n => n.style.visibility == "visible")
        .map(n => n.children[1].children[0]);

    sortByGenres(textPaths).forEach(tp => {            
        const bbox = tp.getBoundingClientRect();
        
        if (quadTree.retrieve(bbox).some(overlap(bbox))){
            tp.style.visibility = "hidden";
        }
            
        quadTree.insert(bbox);
    });    
}

export function setShowLabels(show: boolean) {
    if (show) {
        showNodeLabels(getNodeToLabel());
    } else {
        edgemapState.node.selectChildren("text").style("visibility", "hidden");
    }
    edgemapState.showLabels = show;
}


export type EdgemapView = "genreSimilarity" | "timeline" | "featureSimilarity";
export function updateEdgemap(artists: artistID[] = top150, nextView: EdgemapView = "genreSimilarity") {    
    let {svg, node, link, nodes, links, _simulation: simulation, currentView, timelineAxis, showLabels} = edgemapState;
    const artistSet = new Set(artists);
    const [added, removed] = utils.bothDifference(artistSet, edgemapState.artistSet);    

    const addedNodes = completeNetwork.nodes.filter(n => added.has(n.id)).map(x => ({...x}));
    const addedLinks = completeNetwork.links.filter((l: Link) => {
        const targetAdded = added.has(l.target);
        const sourceAdded = added.has(l.source);
        if (!(sourceAdded || targetAdded)) return false;
        if (targetAdded && sourceAdded) return true;
        const targetAlready = artistSet.has(l.target);
        const sourceAlready = artistSet.has(l.source);
        return  (targetAdded && sourceAlready) || (sourceAdded && targetAlready);
    }).map(x => ({...x}))

    // remove removed nodes & links. Add added nodes & links     
    nodes = nodes
        .filter(n => !removed.has(n.id))
        .concat(addedNodes);
    links = links
        .filter((l: d3Link) => !removed.has(l.source.id) && !removed.has(l.target.id))
        .concat(addedLinks);

    if (removed.size) {
        node.filter((n: d3Node) => removed.has(n.id)).remove();
    }

    const positionKey = EMViewToPositionKey.get(nextView);
    nodes.forEach((n: d3Node) => {
        n.x = n[positionKey].x;
        n.y = n[positionKey].y;
    })

    let [transitionStartCalled, transitionEndCalled] = [false, false];
    if (nextView !== currentView) {
        timelineAxis.style("visibility", nextView === "timeline" ? "visible" : "hidden");

        node
            .call(n => 
                n.transition()
                    .duration(transitionTime)
                    .ease(d3.easeQuadInOut)
                    .attr("transform", (n: d3Node) => utils.d3Translate(n[positionKey]))
                    .on("start", () => {
                        if (!transitionStartCalled) {                                
                            link.style("visibility", "hidden");
                            node.selectChildren("text").style("visibility", "hidden");
                            simulation.stop();
                            simulation = nextView === 'timeline' ? timelineSimulation({nodes, links}) : similaritySimulation({nodes, links});
                            transitionStartCalled = true;                
                        }
                    })
                    .on("end", () => {
                        if (!transitionEndCalled) {
                            const prevEnd = simulation.on("end")
                            simulation.on("end", () => {
                                prevEnd();
                                if (edgemapState.showLabels)
                                    showNodeLabels(edgemapState.node);
                                highlightSelection(edgemapState.selected);  
                            })
                            setSimulation(simulation)
                            transitionEndCalled = true;
                        }
                    })
            );
    } else {
        simulation = nextView === 'timeline' ? timelineSimulation({nodes, links}) : similaritySimulation({nodes, links})
    }

    setLinks(links);
    addedNodes.length && addNodes(svg, addedNodes);

    [node, link] = [svg.selectAll(".node"), svg.selectAll(".link-node")];

    highlightSelection(edgemapState.selected);
    
    edgemapState = {...edgemapState, artistSet, nodes, links, node, link, currentView: nextView};

    if (nextView === currentView) {
        const prevOnEnd = simulation.on("end");
        simulation.on("end", () => {
            prevOnEnd();
            if (showLabels) showNodeLabels(node);
        })
    }

    setSimulation(simulation, nextView !== currentView);   
}