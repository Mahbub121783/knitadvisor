/**
 * KnitAdvisor Academy Engine
 * Source: Understanding Textile for Marchandiser (Chapter 7)
 * Implements textbook knitting theory, needle components, cam/sinker structures, stitch cycles,
 * and weft knitting machinery (Flat, Circular, Single-Jersey, Rib, Interlock, Links-Links)
 */

const GLOSSARY = {
  kink_of_yarn: {
    term: "Kink of yarn",
    definition: "A length of yarn that has been bent into a shape appropriate for its transformation into a weft knitted loop.",
    page: "326"
  },
  knitted_loop: {
    term: "Knitted loop",
    definition: "A kink of yarn that is intermeshed at its base (i.e. when two kinks of yarn are intermeshed, it is called a loop).",
    page: "326"
  },
  knitted_stitch: {
    term: "Knitted stitch",
    definition: "The basic unit of intermeshing; a kink of yarn intermeshed at its base and at its top, usually consisting of three or more intermeshed loops.",
    page: "326"
  },
  top_arc: {
    term: "Top arc",
    definition: "The upper curved portion of the knitted loop.",
    page: "326"
  },
  bottom_half_arc: {
    term: "Bottom half-arc",
    definition: "The lower curved portion that constitutes, in a weft knitted loop, half of the connection to the adjacent loop in the same course.",
    page: "326"
  },
  legs_or_limbs: {
    term: "Legs or side limbs",
    definition: "The lateral parts of the knitted loop that connect the top arc to the bottom half-arcs.",
    page: "326"
  },
  needle_loop: {
    term: "Needle loop",
    definition: "The simplest unit of a knitted structure, formed by the top arc and the two legs of the weft knitted loop. Needle loop = Top arc + Two legs.",
    page: "326"
  },
  sinker_loop: {
    term: "Sinker loop",
    definition: "The yarn portion that connects two adjacent needle loops belonging to the same knitted course. Also called the bottom arc.",
    page: "326"
  },
  open_loop: {
    term: "Open loop",
    definition: "A knitted loop in which the thread enters and leaves at opposite sides without crossing over itself.",
    page: "326"
  },
  closed_loop: {
    term: "Closed loop",
    definition: "A knitted loop in which the thread enters and leaves at opposite sides, crossing over itself. Made by special needles.",
    page: "326"
  },
  course: {
    term: "Course",
    definition: "A predominantly horizontal row of loops (in an upright fabric) produced by adjacent needles during the same knitting cycle.",
    page: "328"
  },
  wale: {
    term: "Wale",
    definition: "A predominantly vertical column of needle loops produced by the same needle knitting at successive knitting cycles, intermeshing each new loop through the previous loop.",
    page: "328"
  },
  stitch_density: {
    term: "Stitch density",
    definition: "The total number of needle loops in a square area measurement (e.g. sq inch or sq cm). Stitch density = Wales per inch (wpi) × Courses per inch (cpi).",
    page: "328"
  },
  intermeshing_points: {
    term: "Intermeshing points",
    definition: "The four points at which stitches are intermeshed on a loop (two at the head and two at the base). Due to unidirectional hooks, loops always show a face loop on one side and a reverse loop on the other.",
    page: "328"
  },
  stitch_length: {
    term: "Stitch / Loop length",
    definition: "The length of yarn knitted into one stitch in a weft knitted fabric, theoretically equal to one needle loop and two half-sinker loops (Stitch Length, l = one needle loop + two half a sinker loop).",
    page: "328"
  },
  face_loop: {
    term: "Face loop or stitch",
    definition: "Also called plain, jersey, or flat stitch. A stitch where the legs are situated above the top arc of the stitch formed in the same wale in the previous course. Shows 'V' shapes on the technical face.",
    page: "328"
  },
  reverse_loop: {
    term: "Reverse loop or stitch",
    definition: "Also called purl stitch. A stitch where the top arc and bottom arcs are situated above the legs of the stitch in the previous and following courses. Shows heads and sinker loops prominently.",
    page: "329"
  },
  single_faced: {
    term: "Single faced structures",
    definition: "Fabrics produced by needles operating as a single set (all hooks facing one direction), drawing loops in the same direction (RL structures).",
    page: "331"
  },
  double_faced: {
    term: "Double faced structures",
    definition: "Fabrics produced when two sets of independently controlled needles (hooks facing opposite directions) draw loops in opposite directions (RR structures).",
    page: "331"
  },
  balanced_structure: {
    term: "Balanced structure",
    definition: "A double-faced structure with an identical number of each type of stitch produced on each needle bed, preventing edge curling.",
    page: "331"
  },
  flat_knitting_machine: {
    term: "Flat Knitting Machine",
    definition: "A versatile knitting machine featuring two stationary flat needle beds in a V configuration. Latch needles are actuated by angular cams mounted in a carriage that traverses reciprocatingly across the machine width.",
    page: "354"
  },
  circular_knitting_machine: {
    term: "Circular Knitting Machine",
    definition: "A weft knitting machine whose needle beds are arranged in a circular cylinder and/or dial, allowing high-speed continuous knitting of tubular fabrics.",
    page: "358"
  },
  fabric_machine: {
    term: "Fabric / Piece Goods Machine",
    definition: "Large-diameter circular machines that knit tubular fabric in continuous uninterrupted lengths of constant width, finished in roll forms at high efficiency.",
    page: "361"
  },
  garment_length_machine: {
    term: "Garment-Length Machine",
    definition: "Knitting machines featuring a counting/timing mechanism to automatically program structural repeat sequences wale-wise, allowing the knitting of ribs, borders, and panel lengths.",
    page: "362"
  },
  rib_gating: {
    term: "Rib Gating",
    definition: "Coordination where the dial and cylinder needle grooves are alternately arranged or gated, allowing the two sets of needles to cross each other and operate concurrently at the same feeder.",
    page: "368"
  },
  interlock_gating: {
    term: "Interlock Gating",
    definition: "Coordination where dial needle grooves are aligned directly opposite cylinder grooves. Needles cannot operate at the same time at the same feeder without colliding; requires selection of long/short needle sets.",
    page: "368"
  },
  synchronized_timing: {
    term: "Synchronized Timing",
    definition: "Cam coordination where cylinder and dial needles reach their knock-over points at the same time, drawing loop segments alternately in two directions under high tension.",
    page: "371"
  },
  delayed_timing: {
    term: "Delayed Timing",
    definition: "Cam coordination where dial needles knock over later than corresponding cylinder needles (by about 4 to 6 needle pitches), robbing yarn from cylinder loops to produce tighter, heavier, and more even structures.",
    page: "374"
  },
  advanced_timing: {
    term: "Advanced Timing",
    definition: "Cam coordination where dial needles knock over earlier than cylinder needles (advanced by about 1 needle pitch), causing cylinder loops to rob from the dial. Used for figured ripple fabrics.",
    page: "376"
  },
  sinker_timing: {
    term: "Sinker Timing / Push Point",
    definition: "The push point or relationship of the sinker advance relative to the needles. Advanced sinkers rob yarn from stitches to form larger sinker loops; delayed sinkers produce tighter, heavier fabric.",
    page: "366"
  },
  purl_knitting_machine: {
    term: "Purl / Links-Links Machine",
    definition: "A machine using double-headed latch needles which can be transferred between opposite beds using sliders, allowing face and reverse loops to be combined in the same wale.",
    page: "380"
  }
};

const BASIC_ELEMENTS = {
  needles: {
    spring_bearded: {
      name: "Spring-Bearded Needle",
      description: "Made of steel wire, requires an external presser mechanism to close the hook. It can be made in finer gauges and is less expensive to manufacture but has speed and structure limitations.",
      parts: {
        stem: "The main body around which the loop is formed.",
        head: "The curved hook portion where the new yarn is drawn through the old loop.",
        beard: "The downward curved continuation of the hook that separates new loops from old loops.",
        eye_or_groove: "Cut in the stem to receive the tip of the beard when pressed."
      },
      page: "337"
    },
    latch: {
      name: "Latch Needle",
      description: "Self-acting or loop-controlled. The loop itself opens and closes the latch hook as the needle moves. It is the most widely used needle in weft knitting.",
      parts: {
        hook: "Encloses and retains the yarn during stitch formation.",
        latch: "Rotates on a pivot or rivet to cover/close the hook.",
        slot_or_saw_cut: "Receives the latch blade.",
        cheeks_or_walls: "Slots punched or riveted to pivot the latch blade.",
        butt: "The protrusion that contacts cam profiles to displace the needle vertically.",
        tail: "The bottom extension keeping the needle stable in its groove (trick)."
      },
      page: "338-339",
      types: {
        friction: "Have a slight bend in the tails to contact groove walls in open cam systems.",
        frictionless: "Move freely in closed cam-tracks with safety guard cams."
      }
    },
    compound: {
      name: "Compound Needle",
      description: "Consists of two separate parts: the hook-carrying stem and the sliding latch/tongue. The two parts rise and fall as a unit but at different speeds. Offers the highest production rates.",
      parts: {
        stem: "Hook-carrying body, made of U-shaped steel wire or a steel tube.",
        sliding_latch: "Sliding tongue or wire that slides along the stem groove to open/close the hook."
      },
      page: "339"
    }
  },
  cams: {
    engineering: {
      name: "Engineering Cams & Eccentrics",
      description: "Circular profiles or eccentrics that move elements en masse as single units (cotton's patent or warp knitting machines). Driven by a central shaft.",
      types: {
        single_acting: "Require powerful springs to maintain follower contact.",
        cam_and_counter: "Double cam setup providing positive drive in both directions.",
        box_cams: "Enclosed track guiding a single follower, subject to directional wear.",
        contour_or_pot_cams: "Projecting lip profile with followers on either side. Easily adjustable."
      },
      page: "341"
    },
    knitting: {
      name: "Knitting Cams",
      description: "Angular profiles acting directly on needle butts to produce individual (seriatim) movement. Fixed in cam boxes.",
      parts: {
        raising_cam: "Raises needles to tuck or clearing height.",
        stitch_cam: "Stitch or lowering cam. Controls depth of needle descent (loop length / gsm).",
        upthrow_cam: "Returns needles to rest position, allowing newly formed loops to relax.",
        guard_cam: "Placed on the opposite side of the cam race to limit butt travel and prevent derailment."
      },
      page: "342-343"
    }
  },
  sinkers: {
    name: "Sinkers",
    description: "Thin metal plates acting at right angles between adjoining needles.",
    functions: {
      loop_forming: "Sinks or kinks the newly laid yarn into loops (especially on spring-bearded frames).",
      holding_down: "Holds down the fabric when needles rise, preventing it from lifting.",
      knocking_over: "Supports the old loops so they can be cast off the needles as new loops are drawn."
    },
    page: "343-344"
  },
  machinery: {
    flat_bed: {
      name: "Flat-Bed Knitting Machine",
      page: "354-357",
      features: [
        "Two stationary needle beds arranged in an inverted V configuration.",
        "Latch needles are operated in tricks by angular cams in a traversing carriage.",
        "Reciprocating carriage movement with automatic yarn guides.",
        "Separate cam systems for each needle bed linked across by a bridge.",
        "Guages typically range from 3 to 18 npi; widths up to 79 inches."
      ],
      advantages: [
        "High versatility: needle selection on one/both beds, racked stitches, needle-out designs.",
        "Wide range of yarn counts can be processed.",
        "Shaping, width changes, and loop transfer (rib to face) are standard."
      ],
      uses: "Trimmings, collars, sweater panels, pullovers, cardigans, hats, and technical 3D shapes."
    },
    circular: {
      name: "Circular Knitting Machine",
      page: "358-360",
      features: [
        "Rotating cylinder needle bed carrying needles in tricks (grooves).",
        "Latch needles and compound needles are most commonly used.",
        "Holding-down sinkers placed between needle tricks on single-jersey machines.",
        "Stationary angular cams in boxes surrounding the cylinder circumference.",
        "Tape positive feed to supply yarn at uniform speeds (course lengths).",
        "Stop motions (top and bottom) to detect thread breaks or high tension.",
        "Lint blowers to prevent lint slubs and contamination.",
        "Lubrication, revolution counters, and fabric wind-down mechanisms."
      ]
    },
    single_jersey: {
      name: "Plain / Single-Jersey Circular Machine",
      page: "361-366",
      desc: "An open-top or sinker-top machine featuring a single set of needles in the cylinder. Simpler, more economical, accommodates more feeders (up to 96+), and runs at high speeds. Popular diameter is 26 inches providing 60-70 inch width.",
      formula: "Ne = G² / 18 (where Ne is Cotton Count and G is Gauge in npi)",
      cam_race: {
        needle: ["Clearing / raising cam", "Stitch / lowering cam", "Upthrow cam", "Guard cams", "Return cams"],
        sinker: ["Race cam", "Sinker-withdrawing cam", "Sinker-return cam"]
      }
    },
    rib: {
      name: "Rib Circular Knitting Machine",
      page: "368-376",
      desc: "Has two sets of latch needles: vertical needles in a rotating cylinder and horizontal needles in a perpendicular dial. Gauge ranges 5 to 20 npi.",
      formula: "Ne = G² / 15.3 (where Ne is Cotton Count and G is Gauge in npi)",
      timing_modes: {
        synchronized: "Cylinder and dial needles knock over at the same instant. Draws yarn in two directions alternately under high tension. Loose structures, uneven stitches.",
        delayed: "Dial needles knock over 4-6 needles later. Robs yarn from cylinder loops. Produces tighter, heavier, wider, and more stable fabrics. Ratio: Cylinder Depth = k × Dial Depth (k = 1.2 to 1.5).",
        advanced: "Cylinder needles rob from dial (cylinder knock-over advanced by ~1 needle). Used for figured ripple fabrics."
      }
    },
    interlock: {
      name: "Interlock Circular Machine",
      page: "377-380",
      desc: "Double-jersey machine featuring aligned dial and cylinder needle grooves (opposite to each other). Long and short needles are gated alternately so that long needles knit at the first feeder and short needles knit at the second feeder. Needs 8 cam systems (eight-lock) across two feeders to produce one full course.",
      gating: "Grooves align directly opposite. Collisions occur if cleared together. Operates in two distinct cycles (long needles / short needles)."
    },
    links_links: {
      name: "Links-Links / Purl Machine",
      page: "380-382",
      desc: "Knits reverse (purl) stitches. Employs double-headed latch needles controlled by sliders. The needle can pass longitudinally from the trick of one bed into the opposite bed, transferring control between the left slider and the right slider.",
      notation: "Face loop (x), Reverse loop (o). Standard repeat height (RH = 2 for reverse jersey, RH = 4 for 2x2 stitch combinations)."
    }
  }
};

const FORMATION_CYCLES = {
  bearded: [
    { stage: 1, name: "Yarn feeding", desc: "Newly fed yarn is laid under the throats of the kinking sinkers." },
    { stage: 2, name: "Yarn sinking", desc: "Sinkers fall down between the needles. The depth of sinking determines the loop length." },
    { stage: 3, name: "Under lapping", desc: "The yarn laid on the needle stems is withdrawn by sinkers into the needle hooks under the beards." },
    { stage: 4, name: "Pressing", desc: "The needle beard tip is pressed into the stem groove by a presser disc, closing the hook with the new loop inside." },
    { stage: 5, name: "Landing", desc: "Knitted fabric loops (old loops) are pushed by cast-off sinkers onto the closed beards." },
    { stage: 6, name: "Joining and casting-off", desc: "Cast-off sinkers push old loops completely off the needle tip onto the new kinked yarn." },
    { stage: 7, name: "Clearing", desc: "New loops are cleared to the needle stems. Fabric is pulled down by the take-down mechanism." }
  ],
  latch: [
    { stage: 1, name: "Clearing", desc: "Needle rises, pushing the old loop down the stem, which opens the latch and slips behind it." },
    { stage: 2, name: "Yarn laying or feeding", desc: "Needle moves down, hook catches new yarn from the yarn guide." },
    { stage: 3, name: "Under lapping or yarn drawing", desc: "Catches and draws the new yarn under the needle hook." },
    { stage: 4, name: "Pressing", desc: "Old loop hits the underside of the open latch, forcing it to pivot upward to cover the hook." },
    { stage: 5, name: "Landing", desc: "Old loop slides over the closed latch and lands on the outside of the hook." },
    { stage: 6, name: "Joining", desc: "New yarn inside the closed hook comes into contact with the landing old loop." },
    { stage: 7, name: "Casting-off or knocking-over", desc: "Old loop slides completely off the top of the hook (knocks over)." },
    { stage: 8, name: "Loop forming and sinking", desc: "Needle descends to draw the new loop through the cast-off old loop. Lower depth makes larger loops." },
    { stage: 9, name: "Loop draw-off", desc: "Sinkers and take-down draw the old loops away from the needles, stabilizing the new loop course." }
  ],
  compound: [
    { stage: 1, name: "Clearing", desc: "Needle stem lifts, sliding latch remains lower, exposing hook. Old loop rests on stem." },
    { stage: 2, name: "Overlapping or yarn laying", desc: "Stem reaches top, yarn guide swings to lay warp yarn over the needle hook." },
    { stage: 3, name: "Underlapping", desc: "Needle stem starts descending, newly overlapped yarn is guided under the hook." },
    { stage: 4, name: "Pressing", desc: "Latch tongue rises relative to stem, enclosing the new loop inside the hook." },
    { stage: 5, name: "Landing-over", desc: "Old loop slides onto the sliding latch tongue." },
    { stage: 6, name: "Joining or meshing", desc: "Old loop meets the new yarn at the closed hook." },
    { stage: 7, name: "Sinking", desc: "Bending of the new warp yarn under the descending needle hook." },
    { stage: 8, name: "Casting-off", desc: "Old loop slides completely off the latch and hook over the new loop." },
    { stage: 9, name: "Loop forming", desc: "Needle completes descent to define the new loop length." },
    { stage: 10, name: "Draw-off", desc: "The new loop is drawn down as the next cycle begins." }
  ]
};

const QUIZ_QUESTIONS = [
  {
    id: "q1",
    question: "What is defined as a length of yarn that has been bent into a shape appropriate for its transformation into a loop?",
    options: [
      "Knitted loop",
      "Kink of yarn",
      "Sinker loop",
      "Warp overlap"
    ],
    answer: 1,
    explanation: "According to page 326 of the textbook, a 'Kink of yarn' is a length of yarn that has been bent into a shape appropriate for its transformation into a weft knitted loop.",
    page: "326"
  },
  {
    id: "q2",
    question: "A needle loop is mathematically represented in the textbook as:",
    options: [
      "Top arc + Sinker loop",
      "Top arc + One leg",
      "Top arc + Two legs",
      "Two legs + Sinker loop"
    ],
    answer: 2,
    explanation: "Page 326 states: 'Needle loop = Top arc + Two legs. The needle loop is the simplest unit of knitted structure.'",
    page: "326"
  },
  {
    id: "q3",
    question: "The yarn portion that connects two adjacent needle loops in the same course is called the:",
    options: [
      "Wale connector",
      "Underlap",
      "Sinker loop",
      "Extended sinker loop"
    ],
    answer: 2,
    explanation: "Page 326 states: 'Sinker loop is the yarn portion that connects two adjacent needle loops belonging in the same knitted course. Bottom arc also called sinker loop.'",
    page: "326"
  },
  {
    id: "q4",
    question: "What is the formula for calculating Stitch Density in a knitted fabric?",
    options: [
      "Wales per inch (wpi) + Courses per inch (cpi)",
      "Wales per inch (wpi) × Courses per inch (cpi)",
      "Courses per inch (cpi) / Wales per inch (wpi)",
      "Stitch Length × Wales per inch (wpi)"
    ],
    answer: 1,
    explanation: "Page 328 states: 'Stitch density = Wales per inch (wpi) x Courses per inch (cpi). Stitch density tends to be a more accurate measurement.'",
    page: "328"
  },
  {
    id: "q5",
    question: "Who patented the latch needle in 1847, initiating a new epoch in knitting technology?",
    options: [
      "William Lee",
      "Jedediah Strutt",
      "Theodor Groz",
      "Matthew Townsend"
    ],
    answer: 3,
    explanation: "Page 323 states: '1847: Matthew Townsend obtains a patent for his invention of the latch needle. A new epoch in the knitting technique begins.'",
    page: "323"
  },
  {
    id: "q6",
    question: "Which English clergyman invented the first hand-operated knitting machine in 1589?",
    options: [
      "Matthew Townsend",
      "Jedediah Strutt",
      "William Lee",
      "Monsieur Decroix"
    ],
    answer: 2,
    explanation: "Page 322 states: 'This invention is usually attributed to a certain English clergyman (1589) William Lee.'",
    page: "322"
  },
  {
    id: "q7",
    question: "What are the three basic elements of knitting technology?",
    options: [
      "Cylinder, Dial, Feeder",
      "Needle, Cam, Sinker",
      "Latch, Hook, Butt",
      "Warp, Weft, Guide bar"
    ],
    answer: 1,
    explanation: "Page 337 states: 'There are three basic elements of knitting, such as needle, cam and sinker.'",
    page: "337"
  },
  {
    id: "q8",
    question: "Which needle type is self-acting (loop-controlled) and does not require a pressing device?",
    options: [
      "Spring-bearded needle",
      "Latch needle",
      "Compound needle",
      "Bearded-slider needle"
    ],
    answer: 1,
    explanation: "Page 338 states: 'The latch needle is the most widely used needle in weft knitting, because it is self-acting or loop controlled.'",
    page: "338"
  },
  {
    id: "q9",
    question: "What part of a latch needle contacts the cam profiles to displace the needle along its groove?",
    options: [
      "Stem",
      "Tail",
      "Rivet",
      "Butt"
    ],
    answer: 3,
    explanation: "Page 339 states: 'The Butt: Which serving to displace the needle along the needle bed slot... contacted by cam profiles.'",
    page: "339"
  },
  {
    id: "q10",
    question: "The compound needle consists of which two separate parts?",
    options: [
      "Hook and Beard",
      "Stem and Sliding latch",
      "Stem and Riveted latch",
      "Slider and Double hook"
    ],
    answer: 1,
    explanation: "Page 339 states: 'In contrast to standard spring-bearded needles and latch needles the compound needle consists of two separate parts- the stem and the sliding latch.'",
    page: "339"
  },
  {
    id: "q11",
    question: "Which cam directly controls the depth to which a needle descends, thereby controlling the loop length?",
    options: [
      "Raising cam",
      "Upthrow cam",
      "Stitch cam",
      "Guard cam"
    ],
    answer: 2,
    explanation: "Page 342 states: 'The Stitch Cam: It controls the depth to which the needle descends thus controlling the amount of yarn drawn into the needle loop.'",
    page: "342"
  },
  {
    id: "q12",
    question: "What is the primary function of a holding-down sinker?",
    options: [
      "To bend the newly fed yarn into a loop",
      "To support old loops so they slide off easily",
      "To hold the fabric down as needles rise, preventing it from lifting",
      "To push the fabric into the take-down rollers"
    ],
    answer: 2,
    explanation: "Page 343 states that the holding-down sinker functions to retain the fabric at the knock-over level when the needles rise, preventing fabric from lifting with the needles.",
    page: "343-344"
  },
  {
    id: "q13",
    question: "How many stages are involved in the loop-forming process on latch needles?",
    options: [
      "Seven",
      "Eight",
      "Nine",
      "Ten"
    ],
    answer: 2,
    explanation: "Page 348 states: 'The loop forming process is divided into nine operations: 1. Clearing, 2. Yarn laying or feeding, 3. Under lapping/drawing, 4. Pressing, 5. Landing, 6. Joining, 7. Casting-off/knocking-over, 8. Loop forming/sinking, 9. Loop draw-off.'",
    page: "348"
  },
  {
    id: "q14",
    question: "In latch needle loop formation, what action causes the old loop to pivot the latch upwards to cover the hook?",
    options: [
      "Yarn laying",
      "Clearing",
      "Pressing",
      "Casting-off"
    ],
    answer: 2,
    explanation: "Page 350 states: 'Pressing: The aim of pressing is to close the needle hook... When the needle lowers, its latch contacts the old loop... closes it.'",
    page: "350"
  },
  {
    id: "q15",
    question: "Which knitting machine spec describes the number of needles per English inch?",
    options: [
      "Working diameter",
      "Working width",
      "Needle pitch",
      "Machine or needle gauge"
    ],
    answer: 3,
    explanation: "Page 333 states: 'The needle gauge of a knitting machine (also called cut or gauge) is a measure expressing the number of needles per a unit of the needle bed (bar) width. Gauge, N = How many needles are used in one English inch.'",
    page: "333"
  },
  {
    id: "q16",
    question: "On flat knitting machines, which type of needle and cam system is typically employed?",
    options: [
      "Spring bearded needles, circular cams",
      "Latch needles, angular cams on a reciprocating carriage",
      "Compound needles, engineering cams",
      "Double-headed needles, stationary circular cams"
    ],
    answer: 1,
    explanation: "Page 354 states: 'Vee-bed flat knitting machines employ latch needles and angular cams of a bi-directional cam system attached to the underside of a carriage traversing reciprocatingly.'",
    page: "354"
  },
  {
    id: "q17",
    question: "What is the typical gauge range (needles per inch) for flat-bed knitting machines according to the textbook?",
    options: [
      "1 to 5 npi",
      "3 to 18 npi",
      "14 to 40 npi",
      "24 to 60 npi"
    ],
    answer: 1,
    explanation: "Page 355 states: 'Normally machine gauge is 3 to 18 needles per inch and machine width up to 79 inches.'",
    page: "355"
  },
  {
    id: "q18",
    question: "Which circular machine mechanism stops the machine if the yarn breaks or tension increases?",
    options: [
      "Automatic lubricator",
      "Revolution counter",
      "Top and bottom stop motions",
      "Tape positive feed"
    ],
    answer: 2,
    explanation: "Page 358 states: 'The top and bottom stop motions are spring-loaded yarn supports... when the yarn breaks or tension increases, they release yarn, stop the machine, and illuminate an indicator.'",
    page: "358"
  },
  {
    id: "q19",
    question: "What is a major advantage of utilizing a side creel and lint blower on a circular knitting machine?",
    options: [
      "It increases machine speed by 50%",
      "It reduces the incidence of knitted-in lint slubs and fiber contamination",
      "It changes the machine gauge automatically",
      "It converts the machine to a flat bed"
    ],
    answer: 1,
    explanation: "Page 360 states: 'Lint blower is used. This reduces the incidence of knitted-in lint slubs, to improve quality... and reduces cross-contamination by fibres.'",
    page: "360"
  },
  {
    id: "q20",
    question: "The textbook formula for estimating a suitable Cotton Count (Ne) for a Single-Jersey machine is:",
    options: [
      "Ne = G² / 18",
      "Ne = G / 18",
      "Ne = G² / 15.3",
      "Ne = G × 18"
    ],
    answer: 0,
    explanation: "Page 362 states: 'An approximately suitable count may be obtained using the formula Ne = G² / 18, where Ne = cotton count... and G = gauge in npi.'",
    page: "362"
  },
  {
    id: "q21",
    question: "What does the term 'open top' or 'sinker top' refer to in circular knitting machines?",
    options: [
      "A machine with no dial needle bed, where the center of the cylinder is open",
      "A machine that cannot knit tubular fabrics",
      "A machine that uses bearded needles only",
      "A machine with an open carriage path"
    ],
    answer: 0,
    explanation: "Page 362 states: 'As the sinker cam-plate is mounted outside the needle circle, the centre of the cylinder is open and the machine is referred to as an open top or sinker top machine.'",
    page: "362"
  },
  {
    id: "q22",
    question: "On a Rib Circular knitting machine, the needle dial is arranged:",
    options: [
      "Vertically, parallel to the cylinder",
      "Horizontally, perpendicular to the cylinder",
      "At a 45-degree angle inside the carriage",
      "Directly behind the sinker ring"
    ],
    answer: 1,
    explanation: "Page 368 states: 'In a rib circular knitting machine, there is one set of needles on the cylinder and a second set arranged perpendicular to the first set and mounted on a horizontal dial.'",
    page: "368"
  },
  {
    id: "q23",
    question: "What is the coordinate arrangement of dial and cylinder grooves on a Rib Gated machine?",
    options: [
      "Dial grooves align directly opposite cylinder grooves",
      "Grooves are alternately arranged (gated) so needles cross each other",
      "Grooves are spaced three needles apart",
      "There are no dial grooves on a rib machine"
    ],
    answer: 1,
    explanation: "Page 368 states: 'Rib gating: The grooves of the dial and the grooves of the cylinder are alternately arranged or gated. With this arrangement, the cylinder and dial needles cross one another.'",
    page: "368"
  },
  {
    id: "q24",
    question: "Why can cylinder and dial needles opposite to each other in Interlock Gating not work at the same time at the same feeder?",
    options: [
      "They are of different needle gauges",
      "They would collide with each other during clearing",
      "They are driven by the same cam",
      "The yarn cannot feed to both beds"
    ],
    answer: 1,
    explanation: "Page 370 states: 'In Interlock gating, cylinder and dial needles are directly opposite... they can never work at the same time, because they would collide while being cleared.'",
    page: "370"
  },
  {
    id: "q25",
    question: "How is a synchronized timing cam setup defined on a dial-and-cylinder machine?",
    options: [
      "Dial needles knock-over their loops later than cylinder needles",
      "Cylinder and dial needles knock-over their loops at the same time",
      "Cylinder needles knit but dial needles only tuck",
      "Needles are actuated manually by a hand crank"
    ],
    answer: 1,
    explanation: "Page 372 states: 'Synchronized timing: The cylinder and the dial needles knock-over their knitted loops at the same time.'",
    page: "372"
  },
  {
    id: "q26",
    question: "In Delayed Timing, the dial knock-over is delayed by about how many needle pitches?",
    options: [
      "Zero (simultaneous)",
      "One needle pitch",
      "Four to six needle pitches",
      "Twelve to fifteen needle pitches"
    ],
    answer: 2,
    explanation: "Page 374 states: 'With delayed timing, the dial knock-over occurs after about four cylinder needles have drawn loops... based on synchronous timing, the dial camplate is moved in the direction of rotation over 5 to 6 needle pitches.'",
    page: "374"
  },
  {
    id: "q27",
    question: "Which of the following is an advantage of using Delayed Timing?",
    options: [
      "Loose structure and uneven stitches",
      "Slower running speeds",
      "Tight structure, evenly formed stitches, and less yarn strain",
      "Requires only single-headed needles"
    ],
    answer: 2,
    explanation: "Page 374 states: 'The advantages of using delayed timing are: Tight structure, Evenly formed stitches, Good rigidity, Heavier and wider fabric, Less strain on the yarn.'",
    page: "374"
  },
  {
    id: "q28",
    question: "For delayed timing, the cylinder knock-over depth is set longer so that Cylinder Depth = k × Dial Depth. What is the value of k?",
    options: [
      "k = 0.5 to 0.8",
      "k = 1.0 (equal)",
      "k = 1.2 to 1.5",
      "k = 2.0 to 3.0"
    ],
    answer: 2,
    explanation: "Page 374 states: 'The knocking-over depth of the cylinder needle must be k times the knocking-over depth of the dial needle, where k = 1.2 ... 1.5.'",
    page: "374"
  },
  {
    id: "q29",
    question: "How many cam systems (locks) per feeder are required to produce a course of ordinary Interlock fabric?",
    options: [
      "Two cam systems (one per bed)",
      "Four cam systems (two per bed)",
      "Eight cam systems (eight-lock: four for cylinder, four for dial across two feeders)",
      "Sixteen cam systems"
    ],
    answer: 2,
    explanation: "Page 379 states: 'Interlock requires eight cam systems or locks in order to produce one complete course, two cam systems for each feeder in each needle bed. Often referred to as eight-lock machines.'",
    page: "379"
  },
  {
    id: "q30",
    question: "The Links-Links or Purl knitting machine uses double-headed latch needles controlled by:",
    options: [
      "Holding-down sinkers",
      "Two sliders per needle (one for each head)",
      "Bearded pressers",
      "Reciprocating cylinder cams only"
    ],
    answer: 1,
    explanation: "Page 380 states: 'The main loop-forming elements are two headed latch needles and needle sliders... Two sliders correspond to each needle (M and N engage left and right head respectively).'",
    page: "380"
  }
];

module.exports = {
  GLOSSARY,
  BASIC_ELEMENTS,
  FORMATION_CYCLES,
  QUIZ_QUESTIONS
};
