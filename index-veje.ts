import { groupBy, sortBy, difference, pullAll, keyBy } from 'lodash';
import fs from 'fs';
// https://dawa.aws.dk/adresser?sognekode=8128&struktur=mini
const brabrand: Address[] = JSON.parse(fs.readFileSync('./brabrand.json').toString('utf-8'));
// https://dawa.aws.dk/adresser?sognekode=8129&struktur=mini
const aarslev: Address[] = JSON.parse(fs.readFileSync('./aarslev.json').toString('utf-8'));

// https://dawa.aws.dk/adresser?sognekode=8129&struktur=mini
const veje: Vej[] = JSON.parse(fs.readFileSync('./veje-i-brabrand.json').toString('utf-8'));
console.log();
const vejeByNavn = keyBy(veje, (v) => v.properties.navn);

const TARGET_COST = 50;

interface Position {
  readonly x: number;
  readonly y: number;
}

interface Vej {
  properties: {
    navn: string;
    visueltcenter_x: number;
    visueltcenter_y: number;
  };
  geometry: {
    type: string;
    coordinates: Array<Array<[number, number]>>;
  };
}

interface Address extends Position {
  readonly vejnavn: string;
  readonly husnr: string;
  readonly etage: string;
  readonly dør: string;
}

function reduceProp<T>(selector: (t: T) => number, reducer: (ns: number[]) => number) {
  return (ts: T[]) => reducer(ts.map(selector));
}

const getX = (a: Address) => a.x;
const getY = (a: Address) => a.y;
const min = (a: number[]) => Math.min.apply(null, a);
const max = (a: number[]) => Math.max.apply(null, a);

class Road {
  public readonly endPoints: [Address, Address];
  public readonly cost: number;
  public readonly count: number;
  public readonly addresses: Address[];
  public readonly vejnavn: string;
  public readonly bbox: [Position, Position];
  geometry: [number, number][][];

  constructor(addrs: Address[]) {
    this.vejnavn = addrs[0].vejnavn;
    this.addresses = addrs
      .sort((a, b) => parseInt(a.husnr) - parseInt(b.husnr))
      .map((a) => ({ vejnavn: a.vejnavn, husnr: a.husnr, etage: a.etage, dør: a.dør, x: a.x, y: a.y }));
    this.cost = cost(this.addresses);
    this.count = this.addresses.length;
    this.endPoints = [this.addresses[0], this.addresses[this.addresses.length - 1]];
    this.bbox = [
      { x: reduceProp(getX, min)(addrs), y: reduceProp(getY, min)(addrs) },
      { x: reduceProp(getX, max)(addrs), y: reduceProp(getY, max)(addrs) },
    ];
    this.geometry = vejeByNavn[this.vejnavn].geometry.coordinates;
  }

  public toString() {
    return `${this.addresses[0].vejnavn}  - Start: ${this.endPoints[0].husnr} - End: ${this.endPoints[1].husnr} - Cost: ${
      this.cost
    } - Count: ${this.count}, BBOX: ${JSON.stringify(this.bbox)}`;
  }
}

function cost(addresses: Address[]): number {
  return addresses.reduce((total, addr) => {
    return total + (addr.etage ? 0.3 : 1);
  }, 0);
}

function roadsClosestTo(roads: Road[], road: Road): Road[] {
  return [...roads].sort((a, b) => distanceBetweenRoads(a, road) - distanceBetweenRoads(b, road));
}

function distanceBetweenRoads(a: Road, b: Road): number {
  const distance = a.addresses.reduce((globalMinDist, addr) => {
    const minimalDistanceBetweenRoads = Math.min.apply(
      null,
      b.addresses.map((bAddr) => simpleDistance(addr, bAddr))
    );
    return minimalDistanceBetweenRoads < globalMinDist ? minimalDistanceBetweenRoads : globalMinDist;
  }, Number.MAX_SAFE_INTEGER);
  return distance;
}

function simpleDistance(p1: Position, p2: Position): number {
  return Math.abs(p1.x - p2.x) + Math.abs(p1.y - p2.y);
}

const allAddresses: Address[] = brabrand.concat(aarslev as any) as any;
const byRoads = groupBy(allAddresses, (a) => a.vejnavn);

const roads = Object.entries(byRoads)
  .map(([_, addresses]) => new Road(addresses))
  .sort((a, b) => b.cost - a.cost);

const roadsWithCount = Object.entries(byRoads).reduce((roads, current) => {
  const [roadName, adr] = current;
  const road = new Road(adr);
  roads[roadName] = road;
  return roads;
}, {} as Record<string, Road>);

// console.log(Object.keys(byRoads));
// console.log(roads.map((r) => r.toString()));
// console.log(roads.length);
// console.log(allAddresses.length);
// console.log(
//   roadsClosestTo(roads, roads.find((r) => r.vejnavn === 'Egebjergvej')!)
//     .slice(0, 6)
//     .map((r) => r.toString())
// );

function getRoute(roads: Road[]): { route: Road[]; remainingRoads: Road[] } {
  const remainingRoads = [...roads];
  let cost = 0;
  const route: Road[] = [];
  while (cost < TARGET_COST && remainingRoads.length) {
    const road = pickRoadCloseToTargetCostAndCloseToRoute(remainingRoads, TARGET_COST - cost, route);
    cost += road.cost;
    remainingRoads.splice(remainingRoads.indexOf(road), 1);
    route.push(road);
  }
  return { route, remainingRoads };
}

function pickRoadCloseToTargetCostAndCloseToRoute(roads: Road[], targetCost: number, currentRoute: Road[]): Road {
  const remainingRoads = currentRoute.length ? roadsClosestTo(roads, currentRoute[0]) : roads;
  return remainingRoads.find((r) => Math.abs(r.cost - targetCost) < 20) || remainingRoads[0];
}

let remainingRoads = [...roads];
let i = 1;
const routes = [];
while (remainingRoads.length > 0) {
  const res = getRoute(remainingRoads);
  // routes.push(res.route.map((road) => ({ ...road, addresses: [road.addresses[0], road.addresses[road.addresses.length - 1]] })));
  routes.push(
    res.route.map((road) => ({ ...road, addresses: [...road.addresses.sort(() => (Math.random() > 0.5 ? 1 : -1))].slice(0, 100) }))
  );
  remainingRoads = res.remainingRoads;
  console.log(`ROUTE ${i}: ${res.route.map((r) => r.toString())}`);
  i++;
}

fs.writeFileSync('routes.json', JSON.stringify(routes));
