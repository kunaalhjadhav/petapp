/** Initial species and breeds. Admins can add, rename or deactivate them later. */
export const SPECIES: Array<{ key: string; name: string; breeds: string[] }> = [
  { key: 'dog', name: 'Dog', breeds: ['Indie', 'Labrador Retriever', 'Golden Retriever', 'German Shepherd', 'Beagle', 'Shih Tzu', 'Pug', 'Rottweiler', 'Siberian Husky', 'Pomeranian', 'Dachshund', 'Doberman', 'Cocker Spaniel', 'Boxer', 'Great Dane', 'Mixed breed'] },
  { key: 'cat', name: 'Cat', breeds: ['Indie', 'Persian', 'Siamese', 'Maine Coon', 'British Shorthair', 'Bengal', 'Ragdoll', 'Himalayan', 'Mixed breed'] },
  { key: 'bird', name: 'Bird', breeds: ['Budgerigar', 'Cockatiel', 'Lovebird', 'Indian Ringneck', 'African Grey', 'Macaw', 'Canary', 'Finch'] },
  { key: 'rabbit', name: 'Rabbit', breeds: ['Holland Lop', 'Rex', 'Lionhead', 'Netherland Dwarf', 'Flemish Giant', 'Mixed breed'] },
  { key: 'hamster', name: 'Hamster', breeds: ['Syrian', 'Dwarf Campbell', 'Winter White', 'Roborovski', 'Chinese'] },
  { key: 'fish', name: 'Fish', breeds: ['Betta', 'Goldfish', 'Guppy', 'Koi', 'Angelfish', 'Molly', 'Tetra'] },
  { key: 'reptile', name: 'Reptile', breeds: ['Leopard Gecko', 'Red-eared Slider', 'Indian Star Tortoise (captive-bred, where legal)', 'Bearded Dragon', 'Ball Python'] },
  { key: 'other', name: 'Other', breeds: ['Guinea Pig', 'Ferret', 'Sugar Glider', 'Mouse', 'Rat'] },
];
