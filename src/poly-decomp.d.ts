declare module 'poly-decomp' {
  type Point = [number, number];
  const decomp: {
    makeCCW(polygon: Point[]): void;
    isSimple(polygon: Point[]): boolean;
    quickDecomp(polygon: Point[]): Point[][];
    removeCollinearPoints(polygon: Point[], precision?: number): number;
    removeDuplicatePoints(polygon: Point[], precision?: number): void;
  };
  export default decomp;
}
