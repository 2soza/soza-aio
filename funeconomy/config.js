/**
 * Fun Economy (gaya OwO) - semua pengaturan ada di sini.
 *
 * Command dikirim TANPA titik/prefix bot, cukup ketik langsung di chat:
 *   scash | scf <jumlah|all> [h/t] | ss <jumlah|all> | sdaily | sgive @user <jumlah> | slb
     *   sbj <jumlah|all> | smines <jumlah|all> [1-3 ranjau] | slottery [jumlah|all] | sdrop <jumlah|all> | spickup | slb [kategori] [global] [n] | smy
 */
module.exports = {
    // Prefix semua command fun economy ("s" + nama command -> scash, scf, ss, ...)
    PREFIX: 's',

    // Nama & emoji mata uang. Boleh pakai emoji custom server, contoh: '<:cash:123456789012345678>'
    CASH_NAME: 'cash',
    CASH_EMOJI: '<:cash:1555123079406026832>',

    // Batas taruhan (sama seperti OwO). "all" = min(saldo, MAX_BET)
    MIN_BET: 1,
    MAX_BET: 250000,

    // Cooldown per pengguna dan command (ms). Game taruhan memakai 15 detik;
    // cash dan daily memakai 5 detik. Set 0 untuk mematikan.
    COOLDOWNS: {
        cash: 5000,
        daily: 5000,
        slots: 15000,
        cf: 15000,
        bj: 15000,
        mines: 15000,
        lottery: 15000,
        lb: 15000,
        my: 15000
    },

    // Registrasi akun fun economy. User baru menekan tombol Register sekali untuk mengaktifkan akun
    // dan menerima bonus cash. Command lain di bot tidak terpengaruh.
    REGISTRATION: {
        ENABLED: true,
        BONUS: 250000,
        // Akun lama yang sudah punya saldo/daily otomatis dianggap terdaftar tanpa bonus.
        GRANDFATHER_EXISTING: true,
        PROMPT_COOLDOWN_MS: 15000
    },

    // Level: XP dari chat hanya untuk akun yang sudah terdaftar.
    LEVELING: {
        ENABLED: true,
        CHAT_XP_MIN: 10,
        CHAT_XP_MAX: 15,
        CHAT_COOLDOWN_MS: 60000,
        DAILY_CHAT_XP_CAP: 3000,
        FIRST_MESSAGE_BONUS: 500,
        DAILY_COMMAND_XP: 100,
        MIN_MESSAGE_LENGTH: 3,
        // Hadiah level up ala OwO: naik ke level N memberi N x REWARD_PER_LEVEL cash (level 20 = 100.000).
        REWARD_PER_LEVEL: 5000,
        // Kirim kartu gambar level up (jatuh ke teks biasa kalau bot tidak boleh upload file).
        LEVELUP_CARD: true,
        FORMULA: { BASE: 200, LINEAR: 100, QUADRATIC: 10 }
    },


    // Durasi animasi coinflip ala OwO
    COINFLIP_ANIMATION_MS: 2000,
    // Durasi tiap tahap berhentinya reel slots (urutan: reel kiri, kanan, tengah)
    SLOT_ANIMATION_STEPS_MS: [1000, 700, 1000],

    // true  -> "ss" tanpa angka / "ss bukti transfer" DIABAIKAN (supaya orang yang
    //          mengetik "ss" artinya screenshot tidak ikut menjalankan slots).
    // false -> "ss" saja = taruhan 1 (persis OwO).
    SLOTS_REQUIRE_AMOUNT: true,

    // Daily: reset tiap pergantian hari di zona waktu di bawah (7 = WIB / Jakarta)
    TIMEZONE_OFFSET_HOURS: 7,
    DAILY: {
        BASE: 500,               // hadiah hari pertama
        PER_STREAK: 100,         // tambahan per hari streak berikutnya
        MAX_STREAK_BONUS_DAYS: 30 // bonus streak berhenti naik setelah hari ke-30
    },

    // Emoji coin flip
    COIN: {
        SPINNING: '<a:coinflip:1555549588943937587>',
        HEADS: '<:head:1555309600897634496>',
        TAILS: '<:tails:1555309785019318325>'
    },

    // Emoji slot saat berputar
    SLOT_SPINNING: '<a:slot:1555535305019490416>',

    // Simbol slots. Jackpot = <:jackpot:1555534323707285555> <:jackpot:1555534323707285555> <:jackpot:1555534323707285555> (x10). Boleh pakai emoji custom server.
    SLOT_EMOJI: {
        banana: '<:banana:1555452508229337169>',
        raspberry: '<:raspberry:1555452597970935818>',
        cherry: '<:cherry:1555452550847930398>',
        slotcash: '<:slotcash:1555467668700532807>',
        jackpot: '<:jackpot:1555534323707285555>',
    },

    // Blackjack (sbj). Menang = bayar 2x, seri = taruhan kembali.
    BLACKJACK: {
        WIN_MULTIPLIER: 2,
        HIT_EMOJI: '👊',
        STAND_EMOJI: '🛑'
    },

    // Mines: payout combinatorial dengan RTP 94% (cocok dengan contoh 2.82x pada 1 ranjau/6 pilihan).
    MINES_RTP: 0.94,

    // Lottery (slottery). Satu pool global, selesai tiap pergantian hari (zona waktu di atas).
    // Peluang menang = total taruhanmu / total pool.
    LOTTERY: {
        MAX_PER_LOTTERY: 250000, // batas total taruhan satu user per lottery
        DM_LOSERS: false         // true = kirim DM ke semua peserta, bukan hanya pemenang
    },

    // Ranking (slb / smy)
    RANK: {
        DEFAULT_SCOPE: 'guild', // 'guild' = server ini, 'global' = semua server (pakai "global"/"g")
        DEFAULT_COUNT: 10,
        MAX_COUNT: 25
    },

    // Emoji pesan
    EMOJI: {
        ERROR: '🚫',
        DAILY: '💰',
        TIMER: '⏱',
        GIVE: '💳',
        TOP: '🏆',
        DROP: '💳',
        PICKUP: '💰',
        LOTTERY: '🎟️',
        STREAK: '🔥',
        LEVEL: '⭐',
        LEVELUP: '🎉',
        GUILD: '🏰'
    }
};
