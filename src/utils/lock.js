class Mutex {
    constructor() {
        this.queue = [];
        this.locked = false;
    }

    async acquire() {
        return new Promise((resolve) => {
            const release = () => {
                if (this.queue.length > 0) {
                    const next = this.queue.shift();
                    next();
                } else {
                    this.locked = false;
                }
            };

            if (this.locked) {
                this.queue.push(() => resolve(release));
            } else {
                this.locked = true;
                resolve(release);
            }
        });
    }
}

const locks = new Map();

const getMatchLock = (matchId) => {
    if (!locks.has(matchId)) {
        locks.set(matchId, new Mutex());
    }
    return locks.get(matchId);
};

module.exports = { getMatchLock };
