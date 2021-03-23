import axios from 'axios'
import fs from 'fs/promises'
import rimraf from 'rimraf'
import ora from 'ora'
import { join } from 'path'
import { DirInfo, ImageInfo, ImageNodeContainer, ImageNodeContainerValueNode, ImagePropertyNode, ImageSoundNode, StringValueNode, WzFile, WzImage } from 'wz-parser'
import { groupBy } from 'lodash'

// Constants
const WZ_DIR_PATH = join(__dirname, './wz')
const DIST_DIR_PATH = join(__dirname, './dist')

// Types
interface MapleBgmData {
  description: string;
  filename: string;
  mark: string;
  metadata: Metadata;
  source: Source;
  youtube: string;
}

interface Metadata {
  albumArtist: AlbumArtist;
  artist: Artist;
  title: string;
  year: string;
  titleAlt?: string;
}

enum AlbumArtist {
  Necord = "NECORD",
  Wizet = "Wizet",
}

enum Artist {
  Asteria = "ASTERIA",
  ChataXOsterProject = "Chata x Oster Project",
  Codasound = "CODASOUND",
  DJSearcher = "DJ Searcher",
  Euphonius = "Euphonius",
  HarukaShimotsuki = "Haruka Shimotsuki",
  IdinaMenzel = "Idina Menzel",
  Jimang = "Jimang",
  MikuniShimokawa = "Mikuni Shimokawa",
  RenLongxin = "Ren Longxin",
  StudioEIM = "StudioEIM",
  TakkyuIshino = "Takkyu Ishino",
  TakkyuIshinoWizet = "Takkyu Ishino\u0000Wizet",
  Wizet = "Wizet",
  さつきがてんこもりFeat初音ミク = "さつき が てんこもり feat. 初音ミク",
  まふまふFeat初音ミク = "まふまふ feat. 初音ミク",
}

interface Source {
  client?: Client;
  date?: Date;
  structure: string;
  version?: string;
}

enum Client {
  Bms = "BMS",
  CMS = "CMS",
  Cmst = "CMST",
  Gms = "GMS",
  JMS = "JMS",
  Kms = "KMS",
  Kmst = "KMST",
  Msea = "MSEA",
  ThMS = "ThMS",
  Tms = "TMS",
  Tmst = "TMST",
}

type MapId = string
type Bgm = string
interface MapString {
  street: string;
  map: string;
}

type MapStringMapping = Record<MapId, MapString>

type MapBgmMapping = Record<MapId, Bgm>

interface BgmData extends MapleBgmData {
  maps: ({ id: MapId } & MapString)[]
}

// Functions
function mkdir(p: string) {
  return fs.mkdir(p, { recursive: true })
}

function rm(p: string) {
  return new Promise<void>((resolve, reject) => {
    rimraf(p, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

async function getMapStringMapping() {
  const entries = await Promise.all((await Promise.all((((await (new WzImage((await (new WzFile(join(WZ_DIR_PATH, 'String.wz'))).parse()).value!
    .dir!.find(n => n.name === 'Map.img')! as ImageInfo).parse().value!.extractImg()))
    .value! as ImagePropertyNode).children as ImageNodeContainerValueNode[])
    .map(async (vn) => {
      return ((await vn.value.extractImg()).value! as ImagePropertyNode).children
    }))).flat()
    .map(async (vn) => {
      const mapId = (+vn.name).toString()
      const data = ((await (vn.value as ImageNodeContainer).extractImg()).value as ImagePropertyNode).children
      return [
        mapId,
        {
          street: (data[0]?.value ?? '') as string,
          map: (data[1]?.value ?? '') as string
        }
      ]
    })) as [string, { street: string; map: string; }][]

  return Object.fromEntries(entries) as MapStringMapping
}

async function getMapBgmMapping() {
  const data: MapBgmMapping = {}
  const tasks = (((await (new WzFile(join(WZ_DIR_PATH, 'Map002.wz'))).parse()).value!.dir!.find(i => i.name === 'Map')! as DirInfo).dir!.filter(i => i.name.startsWith('Map')) as DirInfo[])
    .map(({ dir = [] }) => (async () => {
      const partial: [string, string][] = await Promise.all((dir as ImageInfo[])
        .map<[string, Promise<ImageNodeContainer>]>((ii) => ([(+ii.name.replace('.img', '')).toString(), (new WzImage(ii)).parse().value!.extractImg()]))
        .map<Promise<[string, string]>>(async ([id, pi]) => {
          const i = await pi

          const bgm = (((await (((i.value! as ImagePropertyNode).children.find(c => c.name === 'info')! as ImageNodeContainerValueNode).value.extractImg())).value! as ImagePropertyNode).children as StringValueNode[])
            .find(c => c.name === 'bgm')
          return [id, bgm?.value ?? '']
        }))
      partial.forEach(p => data[p[0]] = p[1])
    }))
  for (const t of tasks) {
    await t()
  }
  return data
}

function mergeBgmData(
  { 
    mapStringMapping, mapBgmMapping, bgmData, bgmList 
  }: { 
    mapStringMapping: MapStringMapping; mapBgmMapping: MapBgmMapping; bgmData: MapleBgmData[], bgmList: string[]
  }
): BgmData[] {
  const bgmMapsMapping = groupBy(
    Object.entries(mapBgmMapping).map(entry => ({ id: entry[0], bgm: entry[1] })),
    'bgm'
  )

  return bgmData.map<BgmData>(d => ({
    ...d,
    maps: (bgmMapsMapping[`${d.source.structure}/${d.filename}`] ?? [])
      .map(m => ({
        id: m.id,
        ...(mapStringMapping[m.id] ?? { street: '', map: '' })
      })),
    downloadable: bgmList.includes(`${d.source.structure}/${d.filename}`)
  }))
}

// Run
(async () => {
  const spinner = ora('Start to build data repo...').start()
  await rm(DIST_DIR_PATH)
  await mkdir(DIST_DIR_PATH)
  const { data: { doneIds: bgmList } }: { data: { doneIds: string[] } } = await axios.get('https://maple-pod.github.io/bgm/build.json')
  const { data: bgmData }: { data: MapleBgmData[] } = await axios.get('https://raw.githubusercontent.com/maplestory-music/maplebgm-db/prod/bgm.min.json')
  const mapBgmMapping = await getMapBgmMapping()
  const mapStringMapping = await getMapStringMapping()
  const result = mergeBgmData({
    bgmList,
    bgmData,
    mapBgmMapping,
    mapStringMapping
  })

  await fs.writeFile(
    join(DIST_DIR_PATH, 'bgm.json'),
    JSON.stringify(
      result,
      null,
      2
    )
  )
  spinner.succeed('Finish building data repo! Ready to deploy!')
})()
