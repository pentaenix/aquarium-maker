interface AquariumGeometryModule {
  buildAquariumDocument(designJson: string): string;
}

export default function createAquariumGeometryModule(): Promise<AquariumGeometryModule>;
