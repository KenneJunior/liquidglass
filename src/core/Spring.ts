/**
 * Physics-based spring animation utility
 *
 * Implements a damped spring oscillator that smoothly animates toward a target value.
 * Used for all tilt, shadow, and refraction animations to create natural, fluid motion.
 *
 * @example
 * const spring = new Spring(0, 300, 20); // value=0, stiffness=300, damping=20
 * spring.setTarget(10); // animate toward 10
 * let value = spring.update(0.016); // update with 16ms delta
 * while (!spring.isSettled()) {
 *   value = spring.update(0.016);
 * }
 */

export class Spring {
    private value: number;
    private target: number;
    private velocity: number;
    private readonly stiffness: number;
    private readonly damping: number;

    /**
     * Create a new spring animator
     * @param v Initial value
     * @param s Stiffness coefficient (higher = faster, less bouncy). Default: 300
     * @param d Damping coefficient (higher = less oscillation). Default: 20
     */
    constructor(v: number, s = 300, d = 20) {
        this.value = v;
        this.target = v;
        this.velocity = 0;
        this.stiffness = s;
        this.damping = d;
    }

    /**
     * Set the target value to animate toward
     * @param t New target value
     */
    setTarget(t: number): void {
        this.target = t;
    }

    public getTarget(): number {
        return this.target;
    }

    public getValue(): number {
        return this.value;
    }

    /**
     * Update the spring for a time step
     * @param dt Delta time in seconds (typically 0.016 for 60fps)
     * @return Current value after this frame
     */
    update(dt: number): number {
        const f: number = (this.target - this.value) * this.stiffness;
        const dmp: number = this.velocity * this.damping;
        this.velocity += (f - dmp) * dt;
        this.value += this.velocity * dt;
        return this.value;
    }

    /**
     * Check if the spring has essentially stopped oscillating
     * @return True if value and velocity are both very close to 0
     */
    isSettled(): boolean {
        return (
            Math.abs(this.target - this.value) < 0.001 &&
            Math.abs(this.velocity) < 0.001
        );
    }
}