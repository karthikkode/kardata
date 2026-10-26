import { getCollection } from "astro:content";
import { selectPosts } from "./posts";

export async function getPosts() {
  return selectPosts(await getCollection("posts"), import.meta.env.DEV);
}
