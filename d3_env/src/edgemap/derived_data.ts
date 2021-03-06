import { artistData, ArtistID, Genre, streamingHistoryNoSkipped, StreamInstance } from "./data";
import "./map_extensions.ts"
import { DefaultMap } from "./map_extensions";
import * as d3 from "d3";

const streamTimes: Date[] = streamingHistoryNoSkipped.map(si => si.endTime);

export const firstArtistStream = streamingHistoryNoSkipped.reduce(
    (acc, stream) => acc.update(stream.artistID, t => t || stream.endTime),
    new Map<ArtistID, Date>()
);

export const artistToGenres: Map<ArtistID, Set<Genre>> = new Map(artistData.map(a => [a.id, new Set(a.genres)]));

export const timeExtent: [Date, Date] = d3.extent(streamTimes);

export function getTimePolyExtent(n: number): Date[] {
    const keys = Array.from(firstArtistStream.keys());
    const poly = [timeExtent[0]];
    for (let i = 1; i < n + 1; i++) {
        poly.push(firstArtistStream.get(keys[Math.floor(keys.length * (i / (n+1)))]));
    }
    return poly.concat([timeExtent[1]]);
}

export const artistStreamTimes: Map<ArtistID, number> = computeStreamTimes();
function computeStreamTimes() {
    const times: Map<ArtistID, number> = streamingHistoryNoSkipped.reduce(
        (acc: DefaultMap<ArtistID, number>, stream: StreamInstance) => 
            acc.update(stream.artistID, t => t + stream.msPlayed),
        new DefaultMap(0)
    );
    const sorted = Array.from(times).sort(([_a1, t1], [_a2, t2]) => t2 - t1)
    return new Map(sorted);
}