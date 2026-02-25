#!/usr/bin/env python3
"""
Category Manager for SuperBrain
Interactive tool to list, edit, and delete categories
"""

import sys
from pathlib import Path

# Ensure backend root is in sys.path (needed when run directly)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.database import get_db
from rich.console import Console
from rich.table import Table
from rich.prompt import Prompt, Confirm
from rich.panel import Panel
import sys

console = Console()

def print_header(text):
    """Print fancy header"""
    console.print(Panel(text, style="bold magenta", expand=False))

def list_all_categories():
    """List all categories with post counts"""
    db = get_db()
    
    if not db.is_connected():
        console.print("[red]❌ Database not connected[/red]")
        return
    
    try:
        # Get category counts using aggregation
        pipeline = [
            {"$group": {"_id": "$category", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}}
        ]
        
        results = list(db.collection.aggregate(pipeline))
        
        if not results:
            console.print("[yellow]No categories found in database[/yellow]")
            return
        
        # Create table
        table = Table(title="📁 All Categories", show_header=True, header_style="bold cyan")
        table.add_column("Category", style="cyan", width=30)
        table.add_column("Posts", justify="right", style="green")
        
        total_posts = 0
        for item in results:
            category = item['_id'] or "Uncategorized"
            count = item['count']
            table.add_row(category, str(count))
            total_posts += count
        
        console.print(table)
        console.print(f"\n[bold]Total: {len(results)} categories, {total_posts} posts[/bold]\n")
        
    except Exception as e:
        console.print(f"[red]❌ Error: {e}[/red]")

def list_posts_by_category(category=None):
    """List all posts in a specific category"""
    db = get_db()
    
    if not db.is_connected():
        console.print("[red]❌ Database not connected[/red]")
        return
    
    if not category:
        category = Prompt.ask("Enter category name")
    
    try:
        # Find posts in this category
        posts = list(db.collection.find({"category": category}).sort("analyzed_at", -1))
        
        if not posts:
            console.print(f"[yellow]No posts found in category '{category}'[/yellow]")
            return
        
        # Create table
        table = Table(title=f"📋 Posts in '{category}'", show_header=True, header_style="bold cyan")
        table.add_column("#", style="dim", width=4)
        table.add_column("Title", style="cyan", width=50)
        table.add_column("Username", style="green", width=15)
        table.add_column("Shortcode", style="yellow", width=15)
        
        for idx, post in enumerate(posts, 1):
            title = post.get('title', 'N/A')[:47] + "..." if len(post.get('title', '')) > 50 else post.get('title', 'N/A')
            username = post.get('username', 'N/A')
            shortcode = post.get('shortcode', 'N/A')
            table.add_row(str(idx), title, username, shortcode)
        
        console.print(table)
        console.print(f"\n[bold]Total: {len(posts)} posts[/bold]\n")
        
    except Exception as e:
        console.print(f"[red]❌ Error: {e}[/red]")

def edit_category():
    """Edit/rename a category"""
    db = get_db()
    
    if not db.is_connected():
        console.print("[red]❌ Database not connected[/red]")
        return
    
    # Show current categories
    console.print("\n[bold cyan]Current Categories:[/bold cyan]")
    list_all_categories()
    
    # Get old category name
    old_category = Prompt.ask("\nEnter category name to rename")
    
    # Check if exists
    count = db.collection.count_documents({"category": old_category})
    if count == 0:
        console.print(f"[red]❌ Category '{old_category}' not found[/red]")
        return
    
    console.print(f"[yellow]Found {count} posts in '{old_category}'[/yellow]")
    
    # Get new category name
    new_category = Prompt.ask("Enter new category name")
    
    # Confirm
    if not Confirm.ask(f"Rename '{old_category}' to '{new_category}' for {count} posts?"):
        console.print("[yellow]Cancelled[/yellow]")
        return
    
    try:
        # Update all posts
        result = db.collection.update_many(
            {"category": old_category},
            {"$set": {"category": new_category}}
        )
        
        console.print(f"[green]✅ Updated {result.modified_count} posts[/green]")
        
    except Exception as e:
        console.print(f"[red]❌ Error: {e}[/red]")

def delete_category():
    """Delete a category (moves posts to 'Uncategorized')"""
    db = get_db()
    
    if not db.is_connected():
        console.print("[red]❌ Database not connected[/red]")
        return
    
    # Show current categories
    console.print("\n[bold cyan]Current Categories:[/bold cyan]")
    list_all_categories()
    
    # Get category name
    category = Prompt.ask("\nEnter category name to delete")
    
    # Check if exists
    count = db.collection.count_documents({"category": category})
    if count == 0:
        console.print(f"[red]❌ Category '{category}' not found[/red]")
        return
    
    console.print(f"[yellow]Found {count} posts in '{category}'[/yellow]")
    console.print("[yellow]These posts will be moved to 'Uncategorized'[/yellow]")
    
    # Confirm
    if not Confirm.ask(f"Delete category '{category}'?", default=False):
        console.print("[yellow]Cancelled[/yellow]")
        return
    
    try:
        # Move posts to Uncategorized
        result = db.collection.update_many(
            {"category": category},
            {"$set": {"category": "Uncategorized"}}
        )
        
        console.print(f"[green]✅ Moved {result.modified_count} posts to 'Uncategorized'[/green]")
        console.print(f"[green]✅ Category '{category}' deleted[/green]")
        
    except Exception as e:
        console.print(f"[red]❌ Error: {e}[/red]")

def main_menu():
    """Main interactive menu"""
    print_header("📁 CATEGORY MANAGER")
    
    while True:
        console.print("\n[bold cyan]Options:[/bold cyan]")
        console.print("1. List all categories")
        console.print("2. List posts by category")
        console.print("3. Rename category")
        console.print("4. Delete category")
        console.print("5. Exit")
        
        choice = Prompt.ask("\nChoose option", choices=["1", "2", "3", "4", "5"])
        
        if choice == "1":
            list_all_categories()
        elif choice == "2":
            list_posts_by_category()
        elif choice == "3":
            edit_category()
        elif choice == "4":
            delete_category()
        elif choice == "5":
            console.print("\n[green]👋 Goodbye![/green]")
            break

if __name__ == "__main__":
    try:
        main_menu()
    except KeyboardInterrupt:
        console.print("\n\n[yellow]Interrupted by user[/yellow]")
        sys.exit(0)
