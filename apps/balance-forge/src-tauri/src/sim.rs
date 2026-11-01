//! Monte Carlo simulations: combat (duels and round-robin) and a one-currency
//! economy over time. Every run can be repeated exactly by giving the same seed.

use rand::rngs::SmallRng;
use rand::{Rng, SeedableRng};
use serde::{Deserialize, Serialize};

pub const MAX_RUNS: u32 = 100_000;

// ---------------------------------------------------------------- combat

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ArmorModel {
    /// Damage minus armor, at least 1.
    Flat,
    /// Damage × K / (K + armor). Armor = K halves damage.
    Percent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Fighter {
    pub name: String,
    pub health: f64,
    pub damage: f64,
    /// Attacks per second (or per turn).
    pub attack_speed: f64,
    #[serde(default)]
    pub armor: f64,
    /// 0 to 1.
    #[serde(default)]
    pub crit_chance: f64,
    #[serde(default = "two")]
    pub crit_multiplier: f64,
    /// 0 to 1.
    #[serde(default = "one")]
    pub hit_chance: f64,
}

fn one() -> f64 {
    1.0
}
fn two() -> f64 {
    2.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CombatRules {
    pub armor_model: ArmorModel,
    /// K in the percent armor model.
    #[serde(default = "hundred")]
    pub armor_constant: f64,
    /// Each hit varies by up to this share either way (0.1 = ±10%).
    #[serde(default)]
    pub damage_variance: f64,
    /// A fight still going after this long is a timeout.
    #[serde(default = "sixty")]
    pub max_time: f64,
}

fn hundred() -> f64 {
    100.0
}
fn sixty() -> f64 {
    600.0
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DuelResult {
    pub runs: u32,
    pub wins_a: u32,
    pub wins_b: u32,
    pub draws: u32,
    pub timeouts: u32,
    pub avg_time: f64,
    pub time_p10: f64,
    pub time_p50: f64,
    pub time_p90: f64,
    /// Average share of health the winner had left (0 to 1).
    pub avg_health_left_a: f64,
    pub avg_health_left_b: f64,
}

pub fn validate_fighter(f: &Fighter) -> Result<(), String> {
    let bad = |what: &str| Err(format!("{}: {what}", f.name));
    if !(f.health > 0.0) {
        return bad("health must be above 0");
    }
    if !(f.attack_speed > 0.0) {
        return bad("attack speed must be above 0");
    }
    if f.damage < 0.0 || !f.damage.is_finite() {
        return bad("damage can't be negative");
    }
    if !(0.0..=1.0).contains(&f.crit_chance) || !(0.0..=1.0).contains(&f.hit_chance) {
        return bad("crit and hit chance must be between 0 and 1");
    }
    Ok(())
}

fn hit(att: &Fighter, def: &Fighter, rules: &CombatRules, rng: &mut SmallRng) -> f64 {
    if att.hit_chance < 1.0 && rng.gen::<f64>() >= att.hit_chance {
        return 0.0;
    }
    let mut dmg = att.damage;
    if rules.damage_variance > 0.0 {
        dmg *= 1.0 + rng.gen_range(-rules.damage_variance..=rules.damage_variance);
    }
    if att.crit_chance > 0.0 && rng.gen::<f64>() < att.crit_chance {
        dmg *= att.crit_multiplier;
    }
    match rules.armor_model {
        ArmorModel::Flat => (dmg - def.armor).max(1.0_f64.min(dmg)),
        ArmorModel::Percent => dmg * rules.armor_constant / (rules.armor_constant + def.armor.max(0.0)),
    }
}

/// One fight. Returns (winner: 0 = A, 1 = B, 2 = draw, 3 = timeout, time, health left of A, of B).
fn fight(a: &Fighter, b: &Fighter, rules: &CombatRules, rng: &mut SmallRng) -> (u8, f64, f64, f64) {
    let (mut ha, mut hb) = (a.health, b.health);
    let (ia, ib) = (1.0 / a.attack_speed, 1.0 / b.attack_speed);
    // A random first swing within one interval, so ties of identical units split fairly.
    let (mut ta, mut tb) = (rng.gen::<f64>() * ia, rng.gen::<f64>() * ib);
    loop {
        let t = ta.min(tb);
        if t > rules.max_time {
            return (3, rules.max_time, ha, hb);
        }
        let a_swings = ta <= tb;
        let b_swings = tb <= ta;
        if a_swings {
            hb -= hit(a, b, rules, rng);
            ta += ia;
        }
        if b_swings {
            ha -= hit(b, a, rules, rng);
            tb += ib;
        }
        match (ha <= 0.0, hb <= 0.0) {
            (true, true) => return (2, t, 0.0, 0.0),
            (false, true) => return (0, t, ha, 0.0),
            (true, false) => return (1, t, 0.0, hb),
            _ => {}
        }
    }
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let i = ((sorted.len() - 1) as f64 * p).round() as usize;
    sorted[i]
}

pub fn duel(a: &Fighter, b: &Fighter, rules: &CombatRules, runs: u32, seed: u64) -> Result<DuelResult, String> {
    validate_fighter(a)?;
    validate_fighter(b)?;
    let runs = runs.clamp(1, MAX_RUNS);
    let mut rng = SmallRng::seed_from_u64(seed);
    let mut r = DuelResult { runs, wins_a: 0, wins_b: 0, draws: 0, timeouts: 0, avg_time: 0.0, time_p10: 0.0, time_p50: 0.0, time_p90: 0.0, avg_health_left_a: 0.0, avg_health_left_b: 0.0 };
    let mut times = Vec::with_capacity(runs as usize);
    let (mut left_a, mut left_b) = (0.0, 0.0);
    for _ in 0..runs {
        let (w, t, ha, hb) = fight(a, b, rules, &mut rng);
        times.push(t);
        match w {
            0 => {
                r.wins_a += 1;
                left_a += ha / a.health;
            }
            1 => {
                r.wins_b += 1;
                left_b += hb / b.health;
            }
            2 => r.draws += 1,
            _ => r.timeouts += 1,
        }
    }
    times.sort_by(|x, y| x.total_cmp(y));
    r.avg_time = times.iter().sum::<f64>() / runs as f64;
    r.time_p10 = percentile(&times, 0.1);
    r.time_p50 = percentile(&times, 0.5);
    r.time_p90 = percentile(&times, 0.9);
    r.avg_health_left_a = if r.wins_a > 0 { left_a / r.wins_a as f64 } else { 0.0 };
    r.avg_health_left_b = if r.wins_b > 0 { left_b / r.wins_b as f64 } else { 0.0 };
    Ok(r)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RoundRobinResult {
    pub names: Vec<String>,
    /// win_rate[i][j] = share of fights i won against j (draws and timeouts count as half).
    pub win_rate: Vec<Vec<f64>>,
    /// Average of each row, i.e. how a unit does against the whole field.
    pub overall: Vec<f64>,
    pub runs_per_pair: u32,
}

/// Every unit fights every other. Total fights are capped at 1,000,000.
pub fn round_robin(fighters: &[Fighter], rules: &CombatRules, runs: u32, seed: u64) -> Result<RoundRobinResult, String> {
    if fighters.len() < 2 {
        return Err("Pick at least two rows to compare".into());
    }
    if fighters.len() > 60 {
        return Err("Round-robin handles up to 60 rows at a time".into());
    }
    for f in fighters {
        validate_fighter(f)?;
    }
    let n = fighters.len();
    let pairs = (n * (n - 1) / 2) as u32;
    let runs_per_pair = runs.clamp(1, MAX_RUNS).min((1_000_000 / pairs).max(1));
    let mut win_rate = vec![vec![0.5; n]; n];
    for i in 0..n {
        for j in (i + 1)..n {
            let d = duel(&fighters[i], &fighters[j], rules, runs_per_pair, seed ^ ((i as u64) << 32 | j as u64))?;
            let half = (d.draws + d.timeouts) as f64 / 2.0;
            let wi = (d.wins_a as f64 + half) / d.runs as f64;
            win_rate[i][j] = wi;
            win_rate[j][i] = 1.0 - wi;
        }
    }
    let overall = (0..n).map(|i| (0..n).filter(|&j| j != i).map(|j| win_rate[i][j]).sum::<f64>() / (n - 1) as f64).collect();
    Ok(RoundRobinResult { names: fighters.iter().map(|f| f.name.clone()).collect(), win_rate, overall, runs_per_pair })
}

// ---------------------------------------------------------------- economy

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Income {
    pub name: String,
    pub min: f64,
    pub max: f64,
    /// Chance each step that this income happens (0 to 1).
    #[serde(default = "one")]
    pub chance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Spend {
    pub name: String,
    pub cost: f64,
    /// Try to buy every N steps (1 = every step).
    #[serde(default = "one_u")]
    pub every: u32,
    /// Keep buying it, or buy it once (an unlock).
    #[serde(default)]
    pub repeat: bool,
}

fn one_u() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EconomyConfig {
    pub players: u32,
    pub steps: u32,
    #[serde(default)]
    pub start_balance: f64,
    pub incomes: Vec<Income>,
    pub spends: Vec<Spend>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpendResult {
    pub name: String,
    /// Share of players who bought it at least once.
    pub reached: f64,
    /// Median step of the first purchase, among players who bought it.
    pub median_first_step: Option<u32>,
    /// Average purchases per player.
    pub avg_purchases: f64,
    /// Share of attempts where the player couldn't afford it.
    pub miss_rate: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EconomyResult {
    pub steps: Vec<u32>,
    pub p10: Vec<f64>,
    pub p50: Vec<f64>,
    pub p90: Vec<f64>,
    pub spends: Vec<SpendResult>,
    pub avg_income_per_step: f64,
    pub avg_spend_per_step: f64,
    pub warnings: Vec<String>,
}

pub fn economy(cfg: &EconomyConfig, seed: u64) -> Result<EconomyResult, String> {
    let players = cfg.players.clamp(1, MAX_RUNS) as usize;
    let steps = cfg.steps.clamp(1, 10_000);
    if players as u64 * steps as u64 > 200_000_000 {
        return Err("That's too much at once: lower players or steps (players × steps up to 200 million)".into());
    }
    for i in &cfg.incomes {
        if i.max < i.min || !(0.0..=1.0).contains(&i.chance) {
            return Err(format!("{}: max must be at least min, and chance between 0 and 1", i.name));
        }
    }
    for s in &cfg.spends {
        if s.cost < 0.0 || s.every == 0 {
            return Err(format!("{}: cost can't be negative and \"every\" must be at least 1", s.name));
        }
    }
    let mut rng = SmallRng::seed_from_u64(seed);
    let mut bal = vec![cfg.start_balance; players];
    let ns = cfg.spends.len();
    let mut bought = vec![0u32; players * ns];
    let mut first = vec![u32::MAX; players * ns];
    let mut attempts = vec![0u64; ns];
    let mut misses = vec![0u64; ns];
    let (mut income_total, mut spend_total) = (0.0, 0.0);

    let samples = 200.min(steps);
    let sample_at: Vec<u32> = (1..=samples).map(|k| ((k as u64 * steps as u64) / samples as u64) as u32).collect();
    let mut next_sample = 0;
    let (mut s_steps, mut p10, mut p50, mut p90) = (vec![], vec![], vec![], vec![]);
    let mut scratch = vec![0.0; players];

    for step in 1..=steps {
        for (p, b) in bal.iter_mut().enumerate() {
            for inc in &cfg.incomes {
                if inc.chance >= 1.0 || rng.gen::<f64>() < inc.chance {
                    let v = if inc.max > inc.min { rng.gen_range(inc.min..=inc.max) } else { inc.min };
                    *b += v;
                    income_total += v;
                }
            }
            for (k, s) in cfg.spends.iter().enumerate() {
                let idx = p * ns + k;
                if step % s.every != 0 || (!s.repeat && bought[idx] > 0) {
                    continue;
                }
                attempts[k] += 1;
                if *b >= s.cost {
                    *b -= s.cost;
                    spend_total += s.cost;
                    bought[idx] += 1;
                    if first[idx] == u32::MAX {
                        first[idx] = step;
                    }
                } else {
                    misses[k] += 1;
                }
            }
        }
        if next_sample < sample_at.len() && step == sample_at[next_sample] {
            scratch.copy_from_slice(&bal);
            scratch.sort_by(|x, y| x.total_cmp(y));
            s_steps.push(step);
            p10.push(percentile(&scratch, 0.1));
            p50.push(percentile(&scratch, 0.5));
            p90.push(percentile(&scratch, 0.9));
            next_sample += 1;
        }
    }

    let spends: Vec<SpendResult> = cfg
        .spends
        .iter()
        .enumerate()
        .map(|(k, s)| {
            let mut firsts: Vec<u32> = (0..players).map(|p| first[p * ns + k]).filter(|&f| f != u32::MAX).collect();
            firsts.sort_unstable();
            let total: u64 = (0..players).map(|p| bought[p * ns + k] as u64).sum();
            SpendResult {
                name: s.name.clone(),
                reached: firsts.len() as f64 / players as f64,
                median_first_step: firsts.get(firsts.len().saturating_sub(1) / 2).copied().filter(|_| !firsts.is_empty()),
                avg_purchases: total as f64 / players as f64,
                miss_rate: if attempts[k] > 0 { misses[k] as f64 / attempts[k] as f64 } else { 0.0 },
            }
        })
        .collect();

    let per = (players as f64) * steps as f64;
    let mut warnings = Vec::new();
    if let (Some(&mid), Some(&end)) = (p50.get(p50.len() / 2), p50.last()) {
        if end > cfg.start_balance.max(1.0) * 10.0 && end > mid * 1.6 {
            warnings.push(format!("Inflation: the typical balance keeps climbing (median {} at step {}, {} at the end). Players earn more than they can spend.", fmt(mid), s_steps[p50.len() / 2], fmt(end)));
        }
    }
    for s in &spends {
        if s.reached < 0.5 {
            warnings.push(format!("Bottleneck: only {:.0}% of players ever afford \"{}\".", s.reached * 100.0, s.name));
        }
    }
    Ok(EconomyResult {
        steps: s_steps,
        p10,
        p50,
        p90,
        spends,
        avg_income_per_step: income_total / per,
        avg_spend_per_step: spend_total / per,
        warnings,
    })
}

fn fmt(v: f64) -> String {
    if v.abs() >= 1000.0 {
        format!("{:.0}", v)
    } else {
        format!("{:.1}", v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(name: &str, health: f64, damage: f64, speed: f64) -> Fighter {
        Fighter { name: name.into(), health, damage, attack_speed: speed, armor: 0.0, crit_chance: 0.0, crit_multiplier: 2.0, hit_chance: 1.0 }
    }
    fn rules() -> CombatRules {
        CombatRules { armor_model: ArmorModel::Flat, armor_constant: 100.0, damage_variance: 0.0, max_time: 600.0 }
    }

    #[test]
    fn stronger_unit_wins_and_mirror_is_even() {
        let r = duel(&f("Knight", 500.0, 40.0, 1.0), &f("Rat", 50.0, 5.0, 1.0), &rules(), 1000, 1).unwrap();
        assert_eq!(r.wins_a, 1000);
        assert!(r.avg_time <= 2.0);
        assert!(r.avg_health_left_a > 0.9);
        let m = duel(&f("A", 100.0, 10.0, 1.0), &f("B", 100.0, 10.0, 1.0), &rules(), 20_000, 7).unwrap();
        let share = m.wins_a as f64 / (m.wins_a + m.wins_b) as f64;
        assert!((share - 0.5).abs() < 0.03, "mirror match share {share}");
    }

    #[test]
    fn same_seed_same_result() {
        let mut r = rules();
        r.damage_variance = 0.2;
        let a = Fighter { crit_chance: 0.3, hit_chance: 0.8, ..f("A", 300.0, 25.0, 1.2) };
        let b = Fighter { armor: 5.0, ..f("B", 350.0, 22.0, 1.0) };
        assert_eq!(duel(&a, &b, &r, 5000, 42).unwrap(), duel(&a, &b, &r, 5000, 42).unwrap());
    }

    #[test]
    fn armor_models() {
        let mut rng = SmallRng::seed_from_u64(0);
        let att = f("A", 1.0, 50.0, 1.0);
        let def = Fighter { armor: 100.0, ..f("D", 1.0, 0.0, 1.0) };
        assert_eq!(hit(&att, &def, &rules(), &mut rng), 1.0);
        let pct = CombatRules { armor_model: ArmorModel::Percent, ..rules() };
        assert_eq!(hit(&att, &def, &pct, &mut rng), 25.0);
        // Zero-damage attackers never deal the 1-damage floor.
        assert_eq!(hit(&f("Z", 1.0, 0.0, 1.0), &def, &rules(), &mut rng), 0.0);
    }

    #[test]
    fn stalemates_time_out() {
        let r = duel(&f("A", 100.0, 0.0, 1.0), &f("B", 100.0, 0.0, 1.0), &rules(), 10, 1).unwrap();
        assert_eq!(r.timeouts, 10);
    }

    #[test]
    fn rejects_bad_fighters() {
        assert!(duel(&f("A", 0.0, 1.0, 1.0), &f("B", 1.0, 1.0, 1.0), &rules(), 10, 1).is_err());
        assert!(duel(&f("A", 1.0, 1.0, 0.0), &f("B", 1.0, 1.0, 1.0), &rules(), 10, 1).is_err());
        assert!(round_robin(&[f("A", 1.0, 1.0, 1.0)], &rules(), 10, 1).is_err());
    }

    #[test]
    fn round_robin_ranks_units() {
        let field = [f("Weak", 100.0, 5.0, 1.0), f("Mid", 200.0, 10.0, 1.0), f("Strong", 400.0, 20.0, 1.0)];
        let r = round_robin(&field, &rules(), 500, 3).unwrap();
        assert!(r.overall[2] > r.overall[1] && r.overall[1] > r.overall[0]);
        assert!((r.win_rate[0][1] + r.win_rate[1][0] - 1.0).abs() < 1e-9);
        assert_eq!(r.win_rate[1][1], 0.5);
    }

    fn econ(players: u32, steps: u32, income: f64, cost: f64) -> EconomyConfig {
        EconomyConfig {
            players,
            steps,
            start_balance: 0.0,
            incomes: vec![Income { name: "Quests".into(), min: income, max: income, chance: 1.0 }],
            spends: vec![Spend { name: "Sword".into(), cost, every: 1, repeat: false }],
        }
    }

    #[test]
    fn economy_tracks_balance_and_purchases() {
        let r = economy(&econ(100, 100, 10.0, 55.0), 1).unwrap();
        assert_eq!(r.spends[0].reached, 1.0);
        assert_eq!(r.spends[0].median_first_step, Some(6));
        assert_eq!(*r.p50.last().unwrap(), 1000.0 - 55.0);
        assert_eq!(r.avg_income_per_step, 10.0);
        assert!(r.warnings.iter().any(|w| w.starts_with("Inflation")));
    }

    #[test]
    fn economy_flags_bottlenecks() {
        let r = economy(&econ(50, 20, 10.0, 1000.0), 1).unwrap();
        assert_eq!(r.spends[0].reached, 0.0);
        assert_eq!(r.spends[0].median_first_step, None);
        assert!(r.warnings.iter().any(|w| w.starts_with("Bottleneck")));
    }

    #[test]
    fn economy_with_a_sink_is_stable() {
        let mut c = econ(200, 500, 10.0, 9.0);
        c.spends[0].repeat = true;
        c.incomes[0].min = 5.0;
        c.incomes[0].max = 15.0;
        let r = economy(&c, 9).unwrap();
        assert!(r.spends[0].avg_purchases > 400.0);
        assert!(r.warnings.iter().all(|w| !w.starts_with("Bottleneck")));
        assert!(r.p10.iter().zip(&r.p90).all(|(a, b)| a <= b));
    }

    #[test]
    fn hundred_thousand_runs_finish() {
        let t = std::time::Instant::now();
        duel(&f("A", 1000.0, 12.0, 1.3), &f("B", 1100.0, 11.0, 1.2), &rules(), 100_000, 5).unwrap();
        economy(&econ(100_000, 100, 10.0, 55.0), 1).unwrap();
        assert!(t.elapsed().as_secs() < 60);
    }
}
