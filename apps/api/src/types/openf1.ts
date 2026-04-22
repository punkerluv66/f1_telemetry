export interface OpenF1Session {
  session_key: number;
  session_type: string;
  session_name: string;
  date_start: string;
  date_end: string | null;
  meeting_key: number;
  circuit_short_name: string;
  country_code: string | null;
  country_name: string;
  location: string;
  gmt_offset: string | null;
  year: number;
}

export interface OpenF1Driver {
  session_key: number;
  driver_number: number;
  broadcast_name: string | null;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  name_acronym: string;
  team_name: string;
  team_colour: string | null;
  headshot_url: string | null;
  country_code: string | null;
}

export interface OpenF1Lap {
  session_key: number;
  driver_number: number;
  lap_number: number;
  date_start: string;
  lap_duration: number | null;
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
  i1_speed: number | null;
  i2_speed: number | null;
  st_speed: number | null;
  is_pit_out_lap: boolean;
}

export interface OpenF1CarDataPoint {
  date: string;
  session_key: number;
  meeting_key: number;
  driver_number: number;
  n_gear: number | null;
  speed: number;
  drs: number | null;
  throttle: number;
  brake: number;
  rpm: number | null;
}

export interface OpenF1LocationPoint {
  date: string;
  session_key: number;
  meeting_key: number;
  driver_number: number;
  x: number;
  y: number;
  z: number;
}

export interface OpenF1SessionResult {
  session_key: number;
  meeting_key: number;
  driver_number: number;
  position: number | null;
  points?: number | null;
  number_of_laps: number | null;
  dnf: boolean;
  dns: boolean;
  dsq: boolean;
  duration: number | string | Array<number | string | null> | null;
  gap_to_leader: number | string | Array<number | string | null> | null;
}

export interface OpenF1PitStop {
  date: string;
  session_key: number;
  meeting_key: number;
  driver_number: number;
  lap_number: number | null;
  lane_duration: number | null;
  stop_duration: number | null;
  pit_duration: number | null;
}
